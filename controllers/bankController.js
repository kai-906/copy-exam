const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const PDFParser = require('pdf2json');

// ─────────────────────────────────────────────────────────────────────
// ADVANCED HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────

// Safe URI decoder for handling unescaped % characters safely
function safeDecode(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(str).trim();
  } catch (e) {
    try {
      return unescape(str).trim();
    } catch (e2) {
      return str.replace(/%([0-9A-F]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16))).trim();
    }
  }
}

// Robust LaTeX Converter for Math and Physics Expressions
function convertToLatex(text) {
  if (!text || typeof text !== 'string') return text;

  return text
    // Replace Numeric Fractions e.g. 3/4 -> $\frac{3}{4}$
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$\\frac{$1}{$2}$')
    // Powers / Superscripts e.g. x^2, 10^-3
    .replace(/([A-Za-z0-9]+)\^([-+]?[0-9]+)/g, '$$$1^{$2}$$')
    // Square roots
    .replace(/√\s*\(?([^)]+)\)?/g, '$\\sqrt{$1}$')
    // Standard Math & Science Symbols
    .replace(/∑/g, '$\\sum$')
    .replace(/∫/g, '$\\int$')
    .replace(/π/gi, '$\\pi$')
    .replace(/∞/g, '$\\infty$')
    .replace(/≤/g, '$\\leq$')
    .replace(/≥/g, '$\\geq$')
    .replace(/≠/g, '$\\neq$')
    .replace(/±/g, '$\\pm$')
    .replace(/×/g, '$\\times$')
    .replace(/÷/g, '$\\div$')
    .replace(/°/g, '^\\circ')
    // Greek Symbols
    .replace(/α/gi, '$\\alpha$')
    .replace(/β/gi, '$\\beta$')
    .replace(/γ/gi, '$\\gamma$')
    .replace(/δ/gi, '$\\delta$')
    .replace(/θ/gi, '$\\theta$')
    .replace(/λ/gi, '$\\lambda$')
    .replace(/μ/gi, '$\\mu$')
    .replace(/σ/gi, '$\\sigma$')
    .replace(/ω/gi, '$\\omega$')
    // Clean up duplicated $ tokens
    .replace(/\$\$/g, '$')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect Diagrams or Figures in Questions
const DIAGRAM_KEYWORDS = [
  'figure', 'fig.', 'diagram', 'image', 'sketch', 'cross-section', 'cross section',
  'layout', 'shown below', 'shown above', 'refer to', 'circuit', 'graph', 'chart',
  'table below', 'as shown', 'see figure', 'shaded', 'given figure'
];

function detectDiagram(text) {
  const lower = (text || '').toLowerCase();
  return DIAGRAM_KEYWORDS.some(kw => lower.includes(kw));
}

// Flexible Question Number Matcher
const QUESTION_START_RE = /^\s*(?:Q(?:uestion|ues|ue)?\s*[.\-:]?\s*(\d{1,3})\b[.):\-]?|\((\d{1,3})\)|(\d{1,3})\s*[.):\-])(?=\s|$)/i;

function matchQuestionNumber(line) {
  const m = QUESTION_START_RE.exec(line || '');
  if (!m) return null;
  const num = m[1] || m[2] || m[3];
  return num ? parseInt(num, 10) : null;
}

function splitIntoQuestionBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let current = null;
  let lastNum = 0;

  lines.forEach(line => {
    const num = matchQuestionNumber(line);
    const looksLikeNewQuestion = num !== null && (lastNum === 0 || num > lastNum || num === lastNum + 1) && num < 1000;

    if (looksLikeNewQuestion) {
      if (current) blocks.push(current);
      current = { number: num, lines: [line] };
      lastNum = num;
    } else if (current) {
      current.lines.push(line);
    }
  });

  if (current) blocks.push(current);
  return blocks.map(b => ({ number: b.number, text: b.lines.join('\n') }));
}

// Answer Key Extraction Logic
function parseAnswerKey(fullText) {
  const keyIdx = fullText.search(/(?:answer\s*key|answers?\s*:|solutions|explanations)/i);
  if (keyIdx === -1) return {};

  const keySection = fullText.substring(keyIdx);
  const pairRe = /\b(\d{1,3})\s*[.):\-]\s*\(?([A-Da-d1-4])\)?\b/g;
  const map = {};
  let match;
  while ((match = pairRe.exec(keySection)) !== null) {
    const num = parseInt(match[1], 10);
    let letter = match[2].toUpperCase();
    if (letter === '1') letter = 'A';
    if (letter === '2') letter = 'B';
    if (letter === '3') letter = 'C';
    if (letter === '4') letter = 'D';
    if (!(num in map)) map[num] = letter;
  }
  return map;
}

// Convert inline options like "(A) option1 (B) option2" into new lines
function splitInlineOptions(text) {
  return text.replace(/(\s+)(?=[•\-]?\s*(?:\(?([A-Da-d1-4])[\).:\-]|\[([A-Da-d1-4])\])\s)/g, '\n');
}

const OPTION_LINE_RE = /^\s*(?:[•\-]?\s*(?:\(?([A-Da-d1-4])[\).:\-]|\[([A-Da-d1-4])\])\s*)\s*(.+)/;

function extractOptionsAndQuestionText(bodyText) {
  const normalized = splitInlineOptions(bodyText);
  const optionsMap = {};
  const questionLines = [];

  normalized.split('\n').forEach(line => {
    const optMatch = OPTION_LINE_RE.exec(line);
    if (optMatch) {
      let key = (optMatch[1] || optMatch[2]).toUpperCase();
      if (key === '1') key = 'A';
      if (key === '2') key = 'B';
      if (key === '3') key = 'C';
      if (key === '4') key = 'D';
      const val = optMatch[3].trim();
      if (val) optionsMap[key] = val;
    } else if (Object.keys(optionsMap).length === 0) {
      questionLines.push(line.trim());
    }
  });

  return { optionsMap, questionText: questionLines.join(' ').replace(/\s+/g, ' ').trim() };
}

function buildQuestionObject(block, answerKeyMap, state) {
  const bodyText = block.text.replace(QUESTION_START_RE, '').trim();
  const { optionsMap, questionText } = extractOptionsAndQuestionText(bodyText);

  const cleanQuestionText = convertToLatex(questionText);
  if (!cleanQuestionText || cleanQuestionText.length < 5) return null;

  const hasOptions = Object.keys(optionsMap).length >= 2;
  const optionsList = hasOptions
    ? [
        convertToLatex(optionsMap['A'] || 'Option A'),
        convertToLatex(optionsMap['B'] || 'Option B'),
        convertToLatex(optionsMap['C'] || 'Option C'),
        convertToLatex(optionsMap['D'] || 'Option D')
      ]
    : ['Numerical / Short Answer'];

  let correctAnswer = null;
  if (hasOptions) {
    const keyLetter = block.number != null ? answerKeyMap[block.number] : undefined;
    if (keyLetter && optionsMap[keyLetter]) {
      const idx = ['A', 'B', 'C', 'D'].indexOf(keyLetter);
      correctAnswer = optionsList[idx];
    } else {
      state.unresolvedCount++;
    }
  }

  const fallbackAnswer = hasOptions ? (optionsList[0] || 'Option A') : 'Short Answer';
  if (!correctAnswer) correctAnswer = fallbackAnswer;

  const hasImage = detectDiagram(cleanQuestionText) || detectDiagram(Object.values(optionsMap).join(' '));

  return {
    question_text: cleanQuestionText,
    options: JSON.stringify(optionsList),
    correct_answer: correctAnswer,
    type: hasOptions ? 'MCQ' : 'SHORT_ANSWER',
    has_image: hasImage
  };
}

// ─────────────────────────────────────────────────────────────────────
// PDF COORDINATE EXTRACTION ENGINE
// ─────────────────────────────────────────────────────────────────────

function extractWithCoordinates(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1);

    pdfParser.on('pdfParser_dataError', errData => reject(new Error(errData.parserError)));

    pdfParser.on('pdfParser_dataReady', pdfData => {
      try {
        const pages = pdfData.Pages || [];
        const allItems = [];

        pages.forEach((page, pageIdx) => {
          const pageWidth = page.Width || 100;
          const midX = pageWidth / 2;

          const rawItems = [];
          (page.Texts || []).forEach(textItem => {
            if (!textItem.R || !textItem.R[0]) return;
            const rawText = safeDecode(textItem.R[0].T || '');
            if (!rawText) return;

            rawItems.push({
              text: rawText,
              x: textItem.x,
              y: textItem.y,
              page: pageIdx
            });
          });

          // Sort by page, column and vertical position
          rawItems.forEach(item => {
            allItems.push({
              ...item,
              col: item.x >= midX ? 1 : 0
            });
          });
        });

        resolve(allItems);
      } catch (err) {
        reject(err);
      }
    });

    pdfParser.loadPDF(filePath);
  });
}

function groupIntoQuestions(items) {
  if (!items || !items.length) return [];

  items.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (a.col !== b.col) return a.col - b.col;
    return a.y - b.y;
  });

  const lines = [];
  let prevY = -999, prevCol = 0, prevPage = 0;

  items.forEach(item => {
    const isNewLine = (item.page !== prevPage) || (item.col !== prevCol) || Math.abs(item.y - prevY) > 0.4;
    if (isNewLine) {
      lines.push(item.text);
    } else {
      lines[lines.length - 1] += ' ' + item.text;
    }
    prevY = item.y;
    prevCol = item.col;
    prevPage = item.page;
  });

  const fullText = lines.join('\n');
  const answerKeyMap = parseAnswerKey(fullText);
  const keyIdx = fullText.search(/(?:answer\s*key|solutions|explanations)/i);
  const bodyText = keyIdx !== -1 ? fullText.substring(0, keyIdx) : fullText;

  const blocks = splitIntoQuestionBlocks(bodyText);
  const state = { unresolvedCount: 0 };
  const questions = [];

  blocks.forEach(block => {
    if (!block.text || block.text.trim().length < 8) return;
    const q = buildQuestionObject(block, answerKeyMap, state);
    if (q) questions.push(q);
  });

  questions.unresolvedAnswerCount = state.unresolvedCount;
  return questions;
}

// Plain-text Fallback Parser
async function fallbackPlainTextParse(filePath) {
  const pdfParseModule = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const parseFunc = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
  const data = await parseFunc(dataBuffer);
  const rawText = data && data.text ? data.text : '';
  if (!rawText.trim()) return [];

  let text = rawText.replace(/Android App|iOS App|PW Website|https?:\/\/\S+|www\.\S+/gi, '');
  text = text.replace(/Page\s*\d+/gi, '');
  text = text.replace(/\r/g, '\n');

  const answerKeyMap = parseAnswerKey(text);
  const keyIdx = text.search(/(?:answer\s*key|solutions|explanations)/i);
  const bodyText = keyIdx !== -1 ? text.substring(0, keyIdx) : text;

  const blocks = splitIntoQuestionBlocks(bodyText);
  const state = { unresolvedCount: 0 };
  const questions = [];

  blocks.forEach(block => {
    if (!block.text || block.text.trim().length < 8) return;
    const q = buildQuestionObject(block, answerKeyMap, state);
    if (q) questions.push(q);
  });

  questions.unresolvedAnswerCount = state.unresolvedCount;
  return questions;
}

// ─────────────────────────────────────────────────────────────────────
// ROUTE HANDLERS
// ─────────────────────────────────────────────────────────────────────

exports.uploadBank = async (req, res) => {
  let filePath = req.file ? req.file.path : null;

  try {
    if (!req.file) return res.status(400).json({ error: 'Please select a PDF file first.' });

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (fileExt !== '.pdf') {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Only .pdf files are supported.' });
    }

    let parsedQuestions = [];

    try {
      const items = await extractWithCoordinates(filePath);
      parsedQuestions = groupIntoQuestions(items);
    } catch (coordErr) {
      console.warn('Fallback to text parser:', coordErr.message);
    }

    if (parsedQuestions.length === 0) {
      parsedQuestions = await fallbackPlainTextParse(filePath);
    }

    if (parsedQuestions.length === 0) {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'No structured questions could be parsed from this PDF.' });
    }

    const bankId = uuidv4();
    const title = req.body.title || req.file.originalname;
    const subject = req.body.subject || 'General';

    let teacherId = req.user ? req.user.id : null;
    if (!teacherId) {
      const row = await new Promise(resolve => db.get('SELECT id FROM Users LIMIT 1', [], (e, r) => resolve(r)));
      teacherId = row ? row.id : uuidv4();
    }

    db.run(
      `INSERT INTO QuestionBanks (id, teacher_id, title, subject) VALUES (?, ?, ?, ?)`,
      [bankId, teacherId, title, subject],
      function (bankErr) {
        if (bankErr) {
          if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return res.status(500).json({ error: 'Failed to save question bank: ' + bankErr.message });
        }

        const stmt = db.prepare(`
          INSERT INTO Questions (id, bank_id, question_text, question_type, options, correct_answer, difficulty)
          VALUES (?, ?, ?, ?, ?, ?, 'MEDIUM')
        `);

        let insertErr = null;
        parsedQuestions.forEach(q => {
          const finalAnswer = q.correct_answer || 'Option A';
          stmt.run(uuidv4(), bankId, q.question_text, q.type || 'MCQ', q.options, finalAnswer, err => {
            if (err && !insertErr) insertErr = err;
          });
        });

        stmt.finalize(qErr => {
          if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
          }
          const finalErr = insertErr || qErr;
          if (finalErr) return res.status(500).json({ error: 'Failed to save questions: ' + finalErr.message });

          res.status(200).json({
            message: `Successfully parsed ${parsedQuestions.length} questions!`,
            bankId,
            stats: {
              total: parsedQuestions.length,
              mcq: parsedQuestions.filter(q => q.type === 'MCQ').length,
              shortAnswer: parsedQuestions.filter(q => q.type === 'SHORT_ANSWER').length
            }
          });
        });
      }
    );

  } catch (error) {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    res.status(500).json({ error: error.message });
  }
};

exports.getTeacherBanks = (req, res) => {
  const teacherId = req.user ? req.user.id : null;
  const query = teacherId
    ? `SELECT * FROM QuestionBanks WHERE teacher_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM QuestionBanks ORDER BY created_at DESC`;
  db.all(query, teacherId ? [teacherId] : [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch question banks' });
    res.json({ banks: rows || [] });
  });
};
exports.getBanks = exports.getTeacherBanks;

exports.getBankQuestions = (req, res) => {
  const bankId = req.params.id;
  db.all(`SELECT * FROM Questions WHERE bank_id = ?`, [bankId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch questions' });
    const formattedRows = (rows || []).map(r => ({
      ...r,
      options: typeof r.options === 'string' ? JSON.parse(r.options) : r.options
    }));
    res.json({ questions: formattedRows });
  });
};

exports.deleteQuestionBank = (req, res) => {
  db.run(`DELETE FROM QuestionBanks WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to delete bank' });
    res.json({ message: 'Question bank deleted successfully' });
  });
};
exports.deleteBank = exports.deleteQuestionBank;

exports.addQuestionManual = (req, res) => {
  const { bank_id, question_text, question_type, options, correct_answer, difficulty, image_url } = req.body;
  const questionId = uuidv4();
  const optionsJSON = typeof options === 'object' ? JSON.stringify(options) : (options || '[]');
  const finalAnswer = correct_answer || 'Option A';
  db.run(
    `INSERT INTO Questions (id, bank_id, question_text, question_type, options, correct_answer, difficulty, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [questionId, bank_id, question_text, question_type || 'MCQ', optionsJSON, finalAnswer, difficulty || 'MEDIUM', image_url || null],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to add question: ' + err.message });
      res.json({ message: 'Question added successfully', questionId });
    }
  );
};

exports.updateQuestion = (req, res) => {
  const { question_text, question_type, options, correct_answer, image_url } = req.body;
  const optionsJSON = typeof options === 'object' ? JSON.stringify(options) : (options || '[]');
  const finalAnswer = correct_answer || 'Option A';
  db.run(
    `UPDATE Questions SET question_text=?, question_type=?, options=?, correct_answer=?, image_url=? WHERE id=?`,
    [question_text, question_type || 'MCQ', optionsJSON, finalAnswer, image_url || null, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update question: ' + err.message });
      res.json({ message: 'Question updated successfully' });
    }
  );
};

exports.deleteQuestion = (req, res) => {
  db.run(`DELETE FROM Questions WHERE id = ?`, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete question' });
    res.json({ message: 'Question deleted successfully' });
  });
};

exports.appendFileToBank = async (req, res) => {
  let filePath = req.file ? req.file.path : null;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded to append' });

    let parsedQuestions = [];
    try {
      const items = await extractWithCoordinates(filePath);
      parsedQuestions = groupIntoQuestions(items);
    } catch(e) {
      parsedQuestions = await fallbackPlainTextParse(filePath);
    }

    const stmt = db.prepare(`
      INSERT INTO Questions (id, bank_id, question_text, question_type, options, correct_answer, difficulty)
      VALUES (?, ?, ?, ?, ?, ?, 'MEDIUM')
    `);

    let insertErr = null;
    parsedQuestions.forEach(q => {
      const finalAnswer = q.correct_answer || 'Option A';
      stmt.run(uuidv4(), req.params.bankId, q.question_text, q.type || 'MCQ', q.options, finalAnswer, err => {
        if (err && !insertErr) insertErr = err;
      });
    });

    stmt.finalize(err => {
      if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch(e) {} }
      const finalErr = insertErr || err;
      if (finalErr) return res.status(500).json({ error: 'Failed to append questions: ' + finalErr.message });
      res.json({ message: `${parsedQuestions.length} questions appended successfully` });
    });

  } catch (error) {
    if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch(e) {} }
    res.status(500).json({ error: 'Failed to append file: ' + error.message });
  }
};
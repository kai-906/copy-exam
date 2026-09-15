const fs = require('fs');
const path = require('path');
const { randomUUID: uuidv4 } = require('crypto');
const db = require('../db');
const PDFParser = require('pdf2json');
const { parseWithGemini } = require('../utils/geminiParser');

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

// Detect Diagrams or Figures in Questions — expanded for engineering PDFs
const DIAGRAM_KEYWORDS = [
  'figure', 'fig.', 'diagram', 'image', 'sketch', 'cross-section', 'cross section',
  'layout', 'shown below', 'shown above', 'refer to', 'circuit', 'graph', 'chart',
  'table below', 'as shown', 'see figure', 'shaded', 'given figure',
  // Engineering specific
  'beam', 'section', 'load', 'msq', 'the figure', 'following figure',
  'shown in', 'given in figure', 'cross section'
];

function detectDiagram(text) {
  const lower = (text || '').toLowerCase();
  return DIAGRAM_KEYWORDS.some(kw => lower.includes(kw));
}

// Flexible Question Number Matcher — supports: 1) 1. (1) Q1 Q.1 Q-1
const QUESTION_START_RE = /^\s*(?:Q(?:uestion|ues|ue)?\s*[.\-:]?\s*(\d{1,3})\s*[.):\-]?|\((\d{1,3})\)\s*|(\d{1,3})\s*[.):\-]\s*)(?=\S)/i;

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

    // Accept: first question, sequential, skipped numbers (like Q17 missing → Q18 still ok),
    // or a number that is within a reasonable lookahead window (+10) to handle gaps/skips
    const isNewQ = num !== null &&
      num < 1000 &&
      num >= 1 &&
      (lastNum === 0 || num === lastNum + 1 || (num > lastNum && num <= lastNum + 10));

    if (isNewQ) {
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

// Convert inline options — handles ALL formats found in engineering PDFs:
//   "(A) text (B) text" — inline
//   "a) 360  c) 480\nb) 720  d) 5040" — 2x2 grid
//   "(A) 15.42 mm   (B) 21.37 mm\n(C) 13.74 mm   (D) 9.68 mm" — 2x2 with parens
//   Multi-line: "(A)\nsome text\n(B)\nother text"
function splitInlineOptions(text) {
  // Handle 2-column grid: "a) ans1  c) ans2" split on 2+ spaces before option letter
  text = text.replace(/([^\n])\s{2,}(\(?[a-dA-D1-4][\)\.:])/g, '$1\n$2');

  // Handle inline packed: "(A) text (B) text" or "(A)text(B)text"
  text = text.replace(/(\s*)(\([A-Da-d1-4]\)|\b[A-Da-d1-4][).])\s/g, '\n$2 ');

  return text;
}

// Enhanced option line regex — matches ALL formats:
//   (A) text  /  A) text  /  A. text  /  [A] text  /  a) text
const OPTION_LINE_RE = /^\s*[\(\[]?([A-Da-d1-4])[\)\].:\-]\s*(.+)/;

function extractOptionsAndQuestionText(bodyText) {
  const normalized = splitInlineOptions(bodyText);
  const optionsMap = {};
  const questionLines = [];
  let optionsStarted = false;

  normalized.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const optMatch = OPTION_LINE_RE.exec(trimmed);
    if (optMatch) {
      let key = optMatch[1].toUpperCase();
      if (key === '1') key = 'A';
      if (key === '2') key = 'B';
      if (key === '3') key = 'C';
      if (key === '4') key = 'D';
      const val = optMatch[2].trim();
      if (val && val.length > 0) {
        // Don't overwrite if already set (keeps first occurrence)
        if (!optionsMap[key]) optionsMap[key] = val;
        optionsStarted = true;
      }
    } else if (!optionsStarted) {
      questionLines.push(trimmed);
    }
    // After options start, non-matching lines are noise (page headers, watermarks)
  });

  return { optionsMap, questionText: questionLines.join(' ').replace(/\s+/g, ' ').trim() };
}

function buildQuestionObject(block, answerKeyMap, state) {
  const bodyText = block.text.replace(QUESTION_START_RE, '').trim();
  const { optionsMap, questionText } = extractOptionsAndQuestionText(bodyText);

  const cleanQuestionText = convertToLatex(questionText);
  // Accept questions with short text if they have an image (diagram-based Qs)
  if (!cleanQuestionText || cleanQuestionText.length < 3) return null;

  const hasOptions = Object.keys(optionsMap).length >= 2;

  // For questions with no extracted options but has answer key → mark as MCQ with placeholders
  const optionsList = hasOptions
    ? [
        convertToLatex(optionsMap['A'] || 'Option A'),
        convertToLatex(optionsMap['B'] || 'Option B'),
        convertToLatex(optionsMap['C'] || 'Option C'),
        convertToLatex(optionsMap['D'] || 'Option D')
      ]
    : answerKeyMap && answerKeyMap[block.number]
      ? ['Option A', 'Option B', 'Option C', 'Option D']  // has answer key but options in image
      : ['Numerical / Short Answer'];

  const isMCQ = hasOptions || (answerKeyMap && answerKeyMap[block.number] !== undefined);

  let correctAnswer = null;
  if (isMCQ) {
    const keyLetter = block.number != null ? answerKeyMap[block.number] : undefined;
    if (keyLetter && optionsList[['A','B','C','D'].indexOf(keyLetter)]) {
      const idx = ['A', 'B', 'C', 'D'].indexOf(keyLetter);
      correctAnswer = optionsList[idx];
    } else if (keyLetter) {
      // Answer key says letter but options were in image — store letter as answer
      correctAnswer = keyLetter;
    } else {
      state.unresolvedCount++;
    }
  }

  const fallbackAnswer = isMCQ ? (optionsList[0] || 'Option A') : 'Short Answer';
  if (!correctAnswer) correctAnswer = fallbackAnswer;

  const hasImage = detectDiagram(cleanQuestionText) || detectDiagram(Object.values(optionsMap).join(' '));

  return {
    question_text: cleanQuestionText,
    options: JSON.stringify(optionsList),
    correct_answer: correctAnswer,
    type: isMCQ ? 'MCQ' : 'SHORT_ANSWER',
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

  // Sort: page → column → Y (top to bottom within each column)
  items.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (a.col !== b.col) return a.col - b.col;
    return a.y - b.y;
  });

  // Group items into text lines — items on same Y (within tolerance) join as one line
  const lines = [];
  let prevY = -999, prevCol = -1, prevPage = -1;

  items.forEach(item => {
    // A new line if: page changed, column changed, or Y differs by > 0.3 units
    const isNewLine = (item.page !== prevPage) ||
                      (item.col !== prevCol) ||
                      Math.abs(item.y - prevY) > 0.3;
    if (isNewLine) {
      lines.push(item.text);
    } else {
      lines[lines.length - 1] += ' ' + item.text;
    }
    prevY    = item.y;
    prevCol  = item.col;
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

// Plain-text Fallback Parser (PDF)
async function fallbackPlainTextParse(filePath) {
  const pdfParseModule = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const parseFunc = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
  const data = await parseFunc(dataBuffer);
  const rawText = data && data.text ? data.text : '';
  if (!rawText.trim()) return [];

  return parseRawText(rawText);
}

// Core text → questions parser (shared by all file types)
function parseRawText(rawText) {
  let text = rawText
    .replace(/Android App|iOS App|PW Website|https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/Page\s*\d+\s*(of\s*\d+)?/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const answerKeyMap = parseAnswerKey(text);
  const keyIdx = text.search(/(?:answer\s*key|answers?\s*:|solutions|explanations)/i);
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

// ── DOCX parser ──────────────────────────────────────────────────────
async function parseDocx(filePath) {
  try {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ path: filePath });
    return parseRawText(result.value || '');
  } catch(e) {
    throw new Error('DOCX parsing failed: ' + e.message + '. Make sure mammoth is installed (npm install mammoth).');
  }
}

// ── TXT / plain-text parser ──────────────────────────────────────────
function parseTxt(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseRawText(text);
}

// ── JSON question bank parser ────────────────────────────────────────
// Supports two formats:
//   1. Array of question objects: [{question, options:[...], answer}]
//   2. Wrapper: { questions: [...] }
function parseJsonBank(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch(e) { throw new Error('Invalid JSON file.'); }

  const arr = Array.isArray(data) ? data : (data.questions || data.bank || []);
  if (!arr.length) throw new Error('No questions found in JSON file.');

  return arr.map(item => {
    const qText = item.question || item.question_text || item.text || item.q || '';
    const opts  = item.options || item.choices || item.answers || [];
    const ans   = item.answer  || item.correct_answer || item.correct || item.key || '';

    if (!qText) return null;

    const optsList = Array.isArray(opts)
      ? opts.map(o => (typeof o === 'object' ? (o.text || o.value || String(o)) : String(o)))
      : [];

    // Resolve correct answer to full text if it's a letter
    let correctAnswer = String(ans).trim();
    if (/^[A-Da-d1-4]$/.test(correctAnswer)) {
      const idx = ['A','B','C','D','1','2','3','4'].indexOf(correctAnswer.toUpperCase());
      const mapped = idx < 4 ? idx : idx - 4;
      correctAnswer = optsList[mapped] || correctAnswer;
    }

    return {
      question_text: qText.trim(),
      options: JSON.stringify(optsList.length >= 2 ? optsList : ['Option A','Option B','Option C','Option D']),
      correct_answer: correctAnswer || (optsList[0] || 'Option A'),
      type: optsList.length >= 2 ? 'MCQ' : 'SHORT_ANSWER',
      has_image: false
    };
  }).filter(Boolean);
}

// ── XLSX / CSV parser ────────────────────────────────────────────────
// Expected columns (any order, case-insensitive):
//   question | option_a / a / opt_a | option_b | option_c | option_d | answer / correct_answer
function parseXlsxOrCsv(filePath, ext) {
  const XLSX = require('xlsx');
  const wb   = XLSX.readFile(filePath);
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) throw new Error('Spreadsheet is empty.');

  // Normalise header keys
  const norm = k => k.toLowerCase().replace(/[\s_\-]+/g, '');

  return rows.map((row, i) => {
    const get = (...keys) => {
      for (const k of keys) {
        for (const rk of Object.keys(row)) {
          if (norm(rk) === norm(k)) return String(row[rk]).trim();
        }
      }
      return '';
    };

    const qText = get('question','question_text','q','ques','text');
    if (!qText) return null;

    const optA = get('option_a','opta','a','opt1','option1','choice_a','choicea');
    const optB = get('option_b','optb','b','opt2','option2','choice_b','choiceb');
    const optC = get('option_c','optc','c','opt3','option3','choice_c','choicec');
    const optD = get('option_d','optd','d','opt4','option4','choice_d','choiced');
    const ans  = get('answer','correct_answer','correct','key','ans');

    const optsList = [optA, optB, optC, optD].filter(Boolean);

    let correctAnswer = ans;
    if (/^[A-Da-d1-4]$/.test(correctAnswer)) {
      const idx = ['A','B','C','D'].indexOf(correctAnswer.toUpperCase());
      correctAnswer = optsList[idx < 0 ? 0 : idx] || correctAnswer;
    }
    if (!correctAnswer) correctAnswer = optsList[0] || 'Option A';

    return {
      question_text: qText,
      options: JSON.stringify(optsList.length >= 2 ? optsList : ['Option A','Option B','Option C','Option D']),
      correct_answer: correctAnswer,
      type: optsList.length >= 2 ? 'MCQ' : 'SHORT_ANSWER',
      has_image: false
    };
  }).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────
// ROUTE HANDLERS
// ─────────────────────────────────────────────────────────────────────

exports.uploadBank = async (req, res) => {
  req.setTimeout(180000); // 3 minutes timeout
  let filePath = req.file ? req.file.path : null;

  try {
    if (!req.file) return res.status(400).json({ error: 'Please select a PDF file first.' });

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (fileExt !== '.pdf') {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Only PDF files (.pdf) are supported.' });
    }

    let parsedQuestions = [];
    let parserUsed = 'built-in';

    // ── Step 1: Try Gemini AI parser ─────────────────────────────────
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here') {
      try {
        console.log('[Bank Upload] Trying Gemini AI parser…');
        parsedQuestions = await parseWithGemini(filePath);
        if (parsedQuestions.length > 0) {
          parserUsed = 'gemini-ai';
          console.log(`[Bank Upload] Gemini extracted ${parsedQuestions.length} questions ✓`);
        } else {
          console.warn('[Bank Upload] Gemini returned 0 questions, falling back…');
        }
      } catch (geminiErr) {
        console.warn('[Bank Upload] Gemini failed, falling back to built-in parser:', geminiErr.message);
      }
    }

    // ── Step 2: Fallback — coordinate-aware PDF parser ────────────────
    if (parsedQuestions.length === 0) {
      try {
        const items = await extractWithCoordinates(filePath);
        parsedQuestions = groupIntoQuestions(items);
        if (parsedQuestions.length > 0) {
          console.log(`[Bank Upload] Coordinate parser extracted ${parsedQuestions.length} questions ✓`);
        }
      } catch (coordErr) {
        console.warn('[Bank Upload] Coordinate parser failed:', coordErr.message);
      }
    }

    // ── Step 3: Last resort — plain-text parser ───────────────────────
    if (parsedQuestions.length === 0) {
      try {
        parsedQuestions = await fallbackPlainTextParse(filePath);
        console.log(`[Bank Upload] Plain-text parser extracted ${parsedQuestions.length} questions`);
      } catch (txtErr) {
        console.warn('[Bank Upload] Plain-text parser failed:', txtErr.message);
      }
    }

    if (parsedQuestions.length === 0) {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({
        error: 'No questions could be extracted from this PDF. Make sure the file contains numbered MCQ questions.'
      });
    }

    const bankId   = uuidv4();
    const title    = req.body.title    || req.file.originalname;
    const subject  = req.body.subject  || 'General';
    const subjectId= req.body.subject_id || req.body.subjectId || null;

    let teacherId = req.user ? req.user.id : null;
    if (!teacherId) {
      const row = await new Promise(resolve => db.get('SELECT id FROM Users LIMIT 1', [], (e, r) => resolve(r)));
      teacherId = row ? row.id : uuidv4();
    }

    db.run(
      `INSERT INTO QuestionBanks (id, teacher_id, title, subject, subject_id) VALUES (?, ?, ?, ?, ?)`,
      [bankId, teacherId, title, subject, subjectId],
      function (bankErr) {
        if (bankErr) {
          if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return res.status(500).json({ error: 'Failed to save question bank: ' + bankErr.message });
        }

        let completed = 0;
        let insertErr = null;

        if (parsedQuestions.length === 0) {
          if (filePath && fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch (e) {}
          return res.status(200).json({
            message: `Successfully extracted 0 questions!`,
            bankId, parserUsed,
            stats: { total: 0, mcq: 0, shortAnswer: 0, withImages: 0 }
          });
        }

        parsedQuestions.forEach(q => {
          const finalAnswer = q.correct_answer || 'Option A';
          const imageNote = q.has_image && q.image_description ? `[image: ${q.image_description}]` : null;
          
          db.run(
            `INSERT INTO Questions (id, bank_id, question_text, question_type, options, correct_answer, difficulty, image_url) VALUES (?, ?, ?, ?, ?, ?, 'MEDIUM', ?)`,
            [uuidv4(), bankId, q.question_text, q.type || 'MCQ', q.options, finalAnswer, imageNote],
            function(err) {
              if (err && !insertErr) insertErr = err;
              completed++;
              
              if (completed === parsedQuestions.length) {
                if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
                if (insertErr) return res.status(500).json({ error: 'Failed to save questions: ' + insertErr.message });
                
                const imageQs = parsedQuestions.filter(q => q.has_image).length;
                res.status(200).json({
                  message: `Successfully extracted ${parsedQuestions.length} questions!`,
                  bankId, parserUsed,
                  stats: {
                    total:       parsedQuestions.length,
                    mcq:         parsedQuestions.filter(q => q.type === 'MCQ').length,
                    shortAnswer: parsedQuestions.filter(q => q.type === 'SHORT_ANSWER').length,
                    withImages:  imageQs
                  }
                });
              }
            }
          );
        });
      }
    );

  } catch (error) {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    res.status(500).json({ error: 'PDF Parsing Failed', details: error.message });
  }
};

exports.getTeacherBanks = (req, res) => {
  const teacherId = req.user ? req.user.id : null;
  const query = teacherId
    ? `SELECT qb.*, COUNT(q.id) AS question_count
       FROM QuestionBanks qb
       LEFT JOIN Questions q ON q.bank_id = qb.id
       WHERE qb.teacher_id = ?
       GROUP BY qb.id
       ORDER BY qb.created_at DESC`
    : `SELECT qb.*, COUNT(q.id) AS question_count
       FROM QuestionBanks qb
       LEFT JOIN Questions q ON q.bank_id = qb.id
       GROUP BY qb.id
       ORDER BY qb.created_at DESC`;
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

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (fileExt !== '.pdf') {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Only PDF files (.pdf) are supported.' });
    }

    let parsedQuestions = [];

    // Try Gemini first
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here') {
      try {
        parsedQuestions = await parseWithGemini(filePath);
      } catch(e) {
        console.warn('[Append] Gemini failed:', e.message);
      }
    }
    // Coordinate fallback
    if (!parsedQuestions.length) {
      try {
        const items = await extractWithCoordinates(filePath);
        parsedQuestions = groupIntoQuestions(items);
      } catch(e) { /* ignore */ }
    }
    // Plain-text last resort
    if (!parsedQuestions.length) {
      parsedQuestions = await fallbackPlainTextParse(filePath);
    }

    if (!parsedQuestions.length) {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'No questions could be extracted from this PDF.' });
    }

    let completed = 0;
    let insertErr = null;

    if (parsedQuestions.length === 0) {
      if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch(e) {} }
      return res.status(400).json({ error: 'No questions could be extracted from this PDF.' });
    }

    parsedQuestions.forEach(q => {
      const finalAnswer = q.correct_answer || 'Option A';
      const imageNote   = q.has_image && q.image_description ? `[image: ${q.image_description}]` : null;
      db.run(
        `INSERT INTO Questions (id, bank_id, question_text, question_type, options, correct_answer, difficulty, image_url) VALUES (?, ?, ?, ?, ?, ?, 'MEDIUM', ?)`,
        [uuidv4(), req.params.bankId, q.question_text, q.type || 'MCQ', q.options, finalAnswer, imageNote],
        function(err) {
          if (err && !insertErr) insertErr = err;
          completed++;
          
          if (completed === parsedQuestions.length) {
            if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch(e) {} }
            if (insertErr) return res.status(500).json({ error: 'Failed to append questions: ' + insertErr.message });
            res.json({ message: `${parsedQuestions.length} questions appended successfully` });
          }
        }
      );
    });

  } catch (error) {
    if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch(e) {} }
    res.status(500).json({ error: 'Failed to append file: ' + error.message });
  }
};
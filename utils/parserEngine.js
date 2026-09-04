const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');

exports.parseFile = async (filePath, fileName) => {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === '.xlsx' || ext === '.csv') {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    return rows.map(r => ({
      question_text: r.Question || r.question_text,
      question_type: r.Type || 'MCQ',
      options: [r.OptionA, r.OptionB, r.OptionC, r.OptionD].filter(Boolean),
      correct_answer: String(r.CorrectAnswer || r.correct_answer),
      default_marks: parseFloat(r.Marks || 1.0)
    }));
  }

  let text = '';
  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    text = parsed.text;
  } else if (ext === '.docx') {
    const parsed = await mammoth.extractRawText({ path: filePath });
    text = parsed.value;
  } else if (ext === '.txt') {
    text = fs.readFileSync(filePath, 'utf8');
  }

  return parsePlainTextQuestions(text);
};

function parsePlainTextQuestions(rawText) {
  const blocks = rawText.split(/Q\d+:|Question\s*\d+:/i).filter(b => b.trim().length > 0);
  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const question_text = lines[0] || 'Sample Question';
    const options = [];
    let correct_answer = '';

    lines.forEach(line => {
      if (/^[A-D]\)/i.test(line) || /^[A-D]\./i.test(line)) {
        options.push(line.replace(/^[A-D][\.\)]\s*/i, ''));
      }
      if (/^Ans:/i.test(line) || /^Answer:/i.test(line)) {
        correct_answer = line.replace(/^Ans(wer)?:\s*/i, '');
      }
    });

    return {
      question_text,
      question_type: options.length > 0 ? 'MCQ' : 'SHORT_ANSWER',
      options,
      correct_answer: correct_answer || options[0] || 'N/A',
      default_marks: 1.0
    };
  });
}
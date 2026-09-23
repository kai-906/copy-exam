const pdfParse = require('pdf-parse');
const fs = require('fs');

exports.parseFile = async (filePath, mimeType) => {
  if (!mimeType || !mimeType.includes('pdf')) {
    throw new Error('Only PDF files (.pdf) are allowed for upload.');
  }

  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  
  const extractedQuestions = parsePdfQuestions(data.text);

  if (!extractedQuestions || extractedQuestions.length === 0) {
    throw new Error('No questions extracted from document. Please verify PDF layout.');
  }

  return extractedQuestions;
};

function parsePdfQuestions(rawText) {
  if (!rawText) return [];

  // Normalize line breaks and remove common header metadata
  let cleanText = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/NAME:\s*GKC181 CA 1\s*Roll No\.:/gi, '')
    .replace(/Android App\s*\|\s*iOS App[\s\S]*?PW Website/gi, '')
    .replace(/https?:\/\/[^\s]+/g, '')
    .trim();

  // Convert inline option prefixes into newline blocks
  cleanText = cleanText.replace(/([a-dA-D][\)\.])\s*/g, '\n$1 ');

  // Split text by Question Numbers at the start of line (e.g., "1)", "2.", "Q1")
  const rawBlocks = cleanText.split(/(?=(?:^|\n)\s*(?:Q\d+|\d+[\)\.]))/gi);
  const parsedQuestions = [];

  for (let block of rawBlocks) {
    block = block.trim();
    if (!block || block.length < 5) continue;

    // Skip Header and Footer Metadata
    if (block.toLowerCase().includes('answer key')) continue;

    // Detect Question Number and Body
    const match = block.match(/^(?:Q\d+|\d+[\)\.])\s*([\s\S]*)/i);
    if (!match) continue;

    let body = match[1].trim();

    // Match options like (A), (B), (C), (D) or a), b), c), d)
    let optionMatches = [...body.matchAll(/(?:^|\n|\s+)(?:\(([A-Da-d])\)|([a-dA-D])[\)\.])\s*([^\n\()]+)/g)];

    let questionText = '';
    let options = [];

    if (optionMatches.length > 0) {
      const firstOptIndex = body.search(/(?:^|\n|\s+)(?:\([A-Da-d]\)|[a-dA-D][\)\.])/);
      questionText = firstOptIndex !== -1 ? body.substring(0, firstOptIndex).trim() : body;
      options = optionMatches.map(m => m[3].trim()).filter(Boolean);
    } else {
      const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
      questionText = lines[0] || body;
      options = lines.slice(1);
    }

    // Clean up excessive whitespace
    questionText = questionText.replace(/\s+/g, ' ').trim();

    if (questionText && questionText.length > 3) {
      parsedQuestions.push({
        question_text: questionText,
        question_type: options.length > 0 ? 'MCQ' : 'SHORT_ANSWER',
        options: options,
        correct_answer: options[0] || '',
        default_marks: 1.0
      });
    }
  }

  return parsedQuestions;
}
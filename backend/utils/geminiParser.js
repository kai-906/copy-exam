/**
 * geminiParser.js
 * ──────────────────────────────────────────────────────────────────────
 * Extracts questions from a PDF using Gemini File API:
 *   1. Upload PDF to Gemini File API (supports image-based/scanned PDFs)
 *   2. Send file URI + prompt to Gemini
 *   3. Parse structured JSON response
 *
 * This handles BOTH text PDFs and image/scanned PDFs.
 * ──────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const GEMINI_MODEL    = 'gemini-3.6-flash';
const FILE_API_UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const FILE_API_GET    = 'https://generativelanguage.googleapis.com/v1beta/files';
const GENERATE_URL    = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const EXTRACTION_PROMPT = `You are an expert question-paper parser for GATE Civil Engineering competitive exams.

This is a scanned/image-based question paper PDF. Read every page carefully.

EXTRACT every question and return ONLY a valid JSON array. No markdown, no explanation.

IMPORTANT — MATH FORMATTING:
Write ALL mathematical expressions using LaTeX notation wrapped in $ delimiters.
Examples:
  gamma_w           ->  $\\gamma_w$
  V_v/V_s           ->  $\\frac{V_v}{V_s}$
  (1+w)/G           ->  $\\frac{1+w}{G}$
  S = ...           ->  $S = \\frac{\\gamma_w(1+w)}{\\gamma} - \\frac{1}{G}$
  cm^3              ->  $cm^3$
  kN/m^3            ->  $kN/m^3$
  wL^3/pi^3*EI      ->  $\\frac{wL^3}{\\pi^3 EI}$
  5/16 * ML^2/EI    ->  $\\frac{5}{16} \\cdot \\frac{ML^2}{EI}$
  sigma_top         ->  $\\sigma_{top}$
  e_max, D_30       ->  $e_{max}$, $D_{30}$
For plain-text options with no math keep as plain text.

JSON Schema for each question:
{
  "number": <integer>,
  "question_text": <string with LaTeX math in $...$ delimiters. For diagram questions add [Diagram: description] at end>,
  "options": { "A": <string>, "B": <string>, "C": <string>, "D": <string> },
  "correct_answer": <string — full text of correct option with LaTeX if applicable>,
  "question_type": <"MCQ" | "MSQ" | "NUMERICAL">,
  "has_image": <boolean>,
  "image_description": <string>
}

RULES:
- Extract ALL questions. Do NOT skip any.
- The last page has an Answer Key — use it to fill correct_answer for every question.
- For numerical/fill-blank (answer is a number), set question_type NUMERICAL, options all empty strings.
- For MSQ (multiple select), set question_type MSQ, correct_answer to first correct option text.
- Return ONLY the JSON array starting with [ and ending with ].`;

/**
 * Upload file to Gemini File API and return the file URI
 */
async function uploadToGeminiFileAPI(filePath, apiKey) {
  const fileBuffer  = fs.readFileSync(filePath);
  const fileName    = path.basename(filePath);
  const mimeType    = 'application/pdf';
  const numBytes    = fileBuffer.length;

  // Step 1: Initiate resumable upload
  const initResp = await fetch(`${FILE_API_UPLOAD}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command':  'start',
      'X-Goog-Upload-Header-Content-Length': numBytes,
      'X-Goog-Upload-Header-Content-Type':   mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: fileName } })
  });

  if (!initResp.ok) {
    const err = await initResp.text();
    throw new Error('File API init failed: ' + err.substring(0, 200));
  }

  const uploadUrl = initResp.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('No upload URL returned from File API');

  // Step 2: Upload the file bytes
  const uploadResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': numBytes,
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': mimeType
    },
    body: fileBuffer
  });

  if (!uploadResp.ok) {
    const err = await uploadResp.text();
    throw new Error('File API upload failed: ' + err.substring(0, 200));
  }

  const uploadData = await uploadResp.json();
  const fileUri    = uploadData?.file?.uri;
  const fileState  = uploadData?.file?.state;

  if (!fileUri) throw new Error('No file URI in upload response: ' + JSON.stringify(uploadData).substring(0,200));

  console.log(`[Gemini File API] Uploaded: ${fileName}, URI: ${fileUri}, state: ${fileState}`);

  // Step 3: Wait for processing if needed
  if (fileState === 'PROCESSING') {
    await waitForFileReady(fileUri, apiKey);
  }

  return fileUri;
}

async function waitForFileReady(fileUri, apiKey) {
  const fileId = fileUri.split('/').pop();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await fetch(`${FILE_API_GET}/${fileId}?key=${apiKey}`);
    const d = await r.json();
    if (d?.file?.state === 'ACTIVE') {
      console.log('[Gemini File API] File ready');
      return;
    }
    console.log(`[Gemini File API] Waiting... state: ${d?.file?.state}`);
  }
  throw new Error('File processing timed out');
}

/**
 * Delete uploaded file from Gemini (cleanup)
 */
async function deleteGeminiFile(fileUri, apiKey) {
  try {
    const fileId = fileUri.split('/').pop();
    await fetch(`${FILE_API_GET}/${fileId}?key=${apiKey}`, { method: 'DELETE' });
  } catch(e) { /* best effort */ }
}

/**
 * parseWithGemini(filePath)
 * @param {string} filePath  Absolute path to uploaded PDF
 * @returns {Promise<Array>} Normalised question objects
 */
async function parseWithGemini(filePath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY not configured in .env');
  }

  let fileUri = null;

  try {
    // Step 1: Upload PDF to Gemini File API
    console.log('[Gemini] Uploading PDF to File API...');
    fileUri = await uploadToGeminiFileAPI(filePath, apiKey);

    // Step 2: Ask Gemini to parse the PDF
    console.log('[Gemini] Requesting question extraction...');
    const body = {
      contents: [{
        parts: [
          { file_data: { mime_type: 'application/pdf', file_uri: fileUri } },
          { text: EXTRACTION_PROMPT }
        ]
      }],
      generationConfig: {
        temperature:     0.05,
        maxOutputTokens: 32768
      }
    };

    const resp = await fetch(GENERATE_URL(GEMINI_MODEL, apiKey), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });

    const responseJson = await resp.json();

    if (!resp.ok) {
      const msg = responseJson?.error?.message || `HTTP ${resp.status}`;
      throw new Error('Gemini generate error: ' + msg);
    }

    const candidate = responseJson?.candidates?.[0];
    if (!candidate) {
      const blockReason = responseJson?.promptFeedback?.blockReason;
      throw new Error(blockReason ? `Blocked: ${blockReason}` : 'No candidates returned');
    }

    const rawText = (candidate.content?.parts || []).map(p => p.text || '').join('');
    if (!rawText.trim()) throw new Error('Gemini returned empty content');

    console.log(`[Gemini] Response received, length: ${rawText.length}`);

    // Step 3: Parse JSON
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch (e2) { throw new Error('JSON parse failed: ' + e.message + '\nSample: ' + cleaned.substring(0,200)); }
      } else {
        throw new Error('No JSON array found. Sample: ' + cleaned.substring(0, 200));
      }
    }

    if (!Array.isArray(parsed)) throw new Error('Response is not an array');
    console.log(`[Gemini] Extracted ${parsed.length} questions`);
    return normalise(parsed);

  } finally {
    // Cleanup: delete file from Gemini
    if (fileUri) {
      deleteGeminiFile(fileUri, apiKey).catch(() => {});
    }
  }
}

function normalise(arr) {
  return arr
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const opts = item.options || {};
      const isNumerical = (item.question_type || '').toUpperCase() === 'NUMERICAL';

      let optsList;
      if (Array.isArray(opts)) {
        optsList = opts.map(String).filter(Boolean);
      } else {
        optsList = [
          String(opts.A || opts.a || '').trim(),
          String(opts.B || opts.b || '').trim(),
          String(opts.C || opts.c || '').trim(),
          String(opts.D || opts.d || '').trim()
        ].filter(o => o.length > 0);
      }

      if (!isNumerical && optsList.length < 2) {
        optsList = ['Option A', 'Option B', 'Option C', 'Option D'];
      }

      let correctAnswer = String(item.correct_answer || '').trim();
      // Resolve letter → full text
      if (/^[A-Da-d]$/.test(correctAnswer) && !isNumerical && optsList.length >= 4) {
        const idx = { A:0,B:1,C:2,D:3,a:0,b:1,c:2,d:3 }[correctAnswer] ?? 0;
        correctAnswer = optsList[idx] || correctAnswer;
      }
      if (!correctAnswer) correctAnswer = isNumerical ? 'See solution' : (optsList[0] || 'Option A');

      const questionText = String(item.question_text || item.question || '').trim();
      if (!questionText || questionText.length < 3) return null;

      // Extract number from question_text if not provided as separate field
      let qNum = item.number || item.num || item.q_number;
      if (!qNum) {
        const m = questionText.match(/^Q?(\d+)\s*[.):\-]/i);
        if (m) qNum = parseInt(m[1]);
      }

      return {
        number:            qNum,
        question_text:     questionText,
        options:           JSON.stringify(isNumerical ? [] : optsList),
        correct_answer:    correctAnswer,
        type:              isNumerical ? 'SHORT_ANSWER' : 'MCQ',
        has_image:         Boolean(item.has_image),
        image_description: String(item.image_description || '').trim()
      };
    })
    .filter(Boolean);
}

module.exports = { parseWithGemini };

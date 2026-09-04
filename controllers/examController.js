const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { generateStudentPaper } = require('../utils/randomization');

// Teacher: Create Exam with Custom Selected Question Subset
exports.createExam = (req, res) => {
  const { 
    title, 
    bank_id, 
    duration_minutes, 
    start_time, 
    end_time, 
    required_attempts_count, 
    shuffle_questions, 
    shuffle_options, 
    proctoring_level,
    selected_question_ids // Array of question IDs chosen by teacher
  } = req.body;

  const examId = uuidv4();
  // Generate a 6-digit random code (e.g., 100000 - 999999)
  const examCode = Math.floor(100000 + Math.random() * 900000).toString();
  const selectedIdsJson = JSON.stringify(selected_question_ids || []);

  const query = `
    INSERT INTO Exams (id, code, teacher_id, title, bank_id, duration_minutes, start_time, end_time, pool_size, required_attempts_count, shuffle_questions, shuffle_options, proctoring_level, selected_question_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    query,
    [
      examId,
      examCode, 
      req.user.id, 
      title, 
      bank_id, 
      duration_minutes, 
      start_time, 
      end_time, 
      selected_question_ids ? selected_question_ids.length : 0, 
      required_attempts_count, 
      shuffle_questions ? 1 : 0, 
      shuffle_options ? 1 : 0, 
      proctoring_level || 'STRICT',
      selectedIdsJson
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ 
        message: 'Exam created successfully', 
        examId, 
        examCode,
        accessLink: `smart-exam://open-exam?key=${examCode}` 
      });
    }
  );
};

// Student: Start Exam & Assign Shuffled Subset from Teacher Selected Questions
exports.startExamAttempt = (req, res) => {
  const { exam_id } = req.body; // Can be UUID or 6-digit code
  const student_id = req.user.id;

  // Find exam by ID or 6-digit code
  db.get(`SELECT * FROM Exams WHERE id = ? OR code = ?`, [exam_id, exam_id], (err, exam) => {
    if (err || !exam) return res.status(404).json({ error: 'Exam not found or invalid exam code.' });

    // Use the actual internal exam.id for the attempt record
    const internal_exam_id = exam.id;

    db.get(`SELECT * FROM ExamAttempts WHERE exam_id = ? AND student_id = ?`, [internal_exam_id, student_id], (err, existingAttempt) => {
      if (err) return res.status(500).json({ error: err.message });

      if (existingAttempt) {
        return res.status(403).json({ error: 'You have already appeared for this exam. Re-attempts are blocked.' });
      }

      const attemptId = uuidv4();
      db.run(`INSERT INTO ExamAttempts (id, exam_id, student_id, status) VALUES (?, ?, ?, 'IN_PROGRESS')`, [attemptId, internal_exam_id, student_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // Parse teacher selected questions array
        let selectedIds = [];
        try {
          selectedIds = JSON.parse(exam.selected_question_ids || '[]');
        } catch (e) {}

        let questionQuery = `SELECT id, question_text, question_type, options, default_marks FROM Questions WHERE bank_id = ?`;
        let queryParams = [exam.bank_id];

        // If teacher selected specific questions, fetch only those
        if (selectedIds.length > 0) {
          const placeholders = selectedIds.map(() => '?').join(',');
          questionQuery = `SELECT id, question_text, question_type, options, default_marks FROM Questions WHERE id IN (${placeholders})`;
          queryParams = selectedIds;
        }

        db.all(questionQuery, queryParams, (err, questions) => {
          if (err || !questions.length) return res.status(400).json({ error: 'Selected question pool is empty.' });

          // Deterministic Random Subset Algorithm per Student
          const assignedPaper = generateStudentPaper(
            questions,
            exam.required_attempts_count || questions.length, // use required count or all if not set
            student_id,
            internal_exam_id,
            Boolean(exam.shuffle_options)
          );

          const stmt = db.prepare(`INSERT INTO AssignedQuestions (attempt_id, question_id, sequence_order, shuffled_options) VALUES (?, ?, ?, ?)`);
          assignedPaper.forEach(item => {
            stmt.run(attemptId, item.id, item.sequence_order, item.shuffled_options);
          });

          stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
              attemptId,
              duration_minutes: exam.duration_minutes,
              title: exam.title,
              questions: sanitizeQuestionsForStudent(assignedPaper)
            });
          });
        });
      });
    });
  });
};

// Helper: Retrieve paper for resumed session
function fetchAssignedPaper(attemptId, res, exam) {
  const query = `
    SELECT q.id, q.question_text, q.question_type, aq.sequence_order, aq.shuffled_options
    FROM AssignedQuestions aq
    JOIN Questions q ON aq.question_id = q.id
    WHERE aq.attempt_id = ?
    ORDER BY aq.sequence_order ASC
  `;
  db.all(query, [attemptId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = rows.map(r => ({
      id: r.id,
      question_text: r.question_text,
      question_type: r.question_type,
      sequence_order: r.sequence_order,
      options: JSON.parse(r.shuffled_options || '[]')
    }));
    res.json({ attemptId, duration_minutes: exam.duration_minutes, title: exam.title, questions: formatted });
  });
}

function sanitizeQuestionsForStudent(questions) {
  return questions.map(q => ({
    id: q.id,
    question_text: q.question_text,
    question_type: q.question_type,
    sequence_order: q.sequence_order,
    options: typeof q.shuffled_options === 'string' ? JSON.parse(q.shuffled_options) : q.options
  }));
}
const db = require('../db');

// 1. Get All Question Banks
exports.getBanks = (req, res) => {
  const teacherId = req.user ? req.user.id : null;
  const query = teacherId
    ? `SELECT * FROM QuestionBanks WHERE teacher_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM QuestionBanks ORDER BY created_at DESC`;

  db.all(query, teacherId ? [teacherId] : [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch question banks' });
    res.json({ banks: rows || [] });
  });
};

// 2. Get All Exams List
exports.getExamsList = (req, res) => {
  const teacherId = req.user ? req.user.id : null;
  const query = teacherId
    ? `SELECT id, title, COALESCE(code, 'CBT EXAM') AS code, duration_minutes, required_attempts_count, created_at FROM Exams WHERE teacher_id = ? ORDER BY created_at DESC`
    : `SELECT id, title, COALESCE(code, 'CBT EXAM') AS code, duration_minutes, required_attempts_count, created_at FROM Exams ORDER BY created_at DESC`;

  db.all(query, teacherId ? [teacherId] : [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database fetch error: ' + err.message });
    res.json({ exams: rows || [] });
  });
};

// 3. Get Detailed Results for Selected Exam (or All Results)
exports.getExamResults = (req, res) => {
  const examId = req.params.examId || req.query.examId;

  if (!examId) {
    return exports.getExamResultsList(req, res);
  }

  const query = `
    SELECT 
      sp.roll_number,
      sp.name,
      sp.branch,
      sp.year,
      ea.id AS attempt_id,
      ea.total_score AS score,
      ea.total_score,
      ea.status,
      ea.start_time,
      ea.end_time,
      COALESCE(e.total_marks, 100) AS total_marks,
      COALESCE(e.pass_marks, 40) AS pass_marks,
      e.title AS exam_title
    FROM ExamAttempts ea
    JOIN StudentProfiles sp ON ea.student_id = sp.student_id
    JOIN Exams e ON ea.exam_id = e.id
    WHERE ea.exam_id = ?
    ORDER BY ea.total_score DESC
  `;

  db.all(query, [examId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch exam results: ' + err.message });
    res.json({ results: rows || [] });
  });
};

// 4. Get Overview Results List across all exams
exports.getExamResultsList = (req, res) => {
  const query = `
    SELECT 
      sp.roll_number,
      sp.name,
      sp.branch,
      sp.year,
      ea.id AS attempt_id,
      ea.total_score AS score,
      ea.total_score,
      ea.status,
      ea.start_time,
      ea.end_time,
      e.id AS exam_id,
      e.title AS exam_title,
      COALESCE(e.total_marks, 100) AS total_marks,
      COALESCE(e.pass_marks, 40) AS pass_marks
    FROM ExamAttempts ea
    JOIN StudentProfiles sp ON ea.student_id = sp.student_id
    JOIN Exams e ON ea.exam_id = e.id
    ORDER BY ea.start_time DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch results overview: ' + err.message });
    res.json({ results: rows || [] });
  });
};

// 5. Get Registered Students Directory with Photo
exports.getRegisteredStudents = (req, res) => {
  const query = `
    SELECT StudentProfiles.roll_number, StudentProfiles.name, StudentProfiles.branch, 
           StudentProfiles.year, StudentProfiles.profile_photo, Users.email
    FROM StudentProfiles
    JOIN Users ON StudentProfiles.student_id = Users.id
    ORDER BY StudentProfiles.roll_number ASC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch student directory: ' + err.message });
    res.json({ students: rows || [] });
  });
};
const db = require('../db');

// Save or update an answer choice during exam
exports.saveAnswer = (req, res) => {
  const { attempt_id, question_id, response, is_marked_for_review } = req.body;

  const query = `
    INSERT INTO StudentAnswers (attempt_id, question_id, student_response, is_marked_for_review)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(attempt_id, question_id) DO UPDATE SET
      student_response = excluded.student_response,
      is_marked_for_review = excluded.is_marked_for_review
  `;

  db.run(query, [attempt_id, question_id, response, is_marked_for_review ? 1 : 0], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'saved' });
  });
};

// Final exam submission & auto-evaluation
exports.submitExam = (req, res) => {
  const { attempt_id } = req.body;

  db.get(
    `SELECT * FROM ExamAttempts WHERE id = ? AND student_id = ?`,
    [attempt_id, req.user.id],
    (err, attempt) => {
      if (err || !attempt) return res.status(404).json({ error: 'Attempt record not found.' });

      if (attempt.status === 'SUBMITTED') {
        return res.status(400).json({ error: 'This exam has already been submitted.' });
      }

      // Calculate score & update status
      const scoreQuery = `
        SELECT sa.question_id, sa.student_response, q.correct_answer, q.default_marks, q.negative_marks
        FROM StudentAnswers sa
        JOIN Questions q ON sa.question_id = q.id
        WHERE sa.attempt_id = ?
      `;

      db.all(scoreQuery, [attempt_id], (err, answers) => {
        if (err) return res.status(500).json({ error: err.message });

        let totalScore = 0;
        answers.forEach((ans) => {
          if (ans.student_response && ans.student_response.trim().toLowerCase() === ans.correct_answer.trim().toLowerCase()) {
            totalScore += ans.default_marks;
          } else if (ans.student_response) {
            totalScore -= (ans.negative_marks || 0);
          }
        });

        db.run(
          `UPDATE ExamAttempts SET status = 'SUBMITTED', end_time = CURRENT_TIMESTAMP, total_score = ? WHERE id = ?`,
          [totalScore, attempt_id],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Exam submitted successfully', score: totalScore });
          }
        );
      });
    }
  );
};
exports.getMyResults = (req, res) => {
  const studentId = req.user.id;

  const profileQuery = `
    SELECT name, roll_number, branch, year, profile_photo FROM StudentProfiles WHERE student_id = ?
  `;

  const resultsQuery = `
    SELECT 
      ea.id, 
      ea.exam_id,
      Exams.title AS exam_title, 
      ea.status, 
      ea.total_score, 
      COALESCE(Exams.total_marks, 100) AS total_marks,
      COALESCE(Exams.pass_marks, 40) AS pass_marks,
      ea.start_time,
      ea.end_time,
      ea.start_time AS created_at
    FROM ExamAttempts ea
    JOIN Exams ON ea.exam_id = Exams.id
    WHERE ea.student_id = ?
    ORDER BY ea.start_time DESC
  `;

  db.get(profileQuery, [studentId], (err, profile) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch student profile: ' + err.message });

    db.all(resultsQuery, [studentId], (err, results) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch exam history: ' + err.message });

      res.json({
        studentProfile: profile || {},
        results: results || []
      });
    });
  });
};
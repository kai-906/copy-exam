const db = require('../db');
const { randomUUID: uuidv4 } = require('crypto');

/* ── Save / update a student answer ─────────────────────────── */
exports.saveAnswer = (req, res) => {
  const { attempt_id, question_id, response, is_marked_for_review } = req.body;
  db.run(
    `INSERT INTO StudentAnswers (attempt_id, question_id, student_response, is_marked_for_review)
     VALUES (?,?,?,?)
     ON CONFLICT(attempt_id, question_id) DO UPDATE SET
       student_response     = excluded.student_response,
       is_marked_for_review = excluded.is_marked_for_review`,
    [attempt_id, question_id, response, is_marked_for_review ? 1 : 0],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ status: 'saved' });
    }
  );
};

/* ── Submit exam & auto-score ────────────────────────────────── */
exports.submitExam = (req, res) => {
  const { attempt_id } = req.body;
  db.get(
    `SELECT * FROM ExamAttempts WHERE id=? AND student_id=?`,
    [attempt_id, req.user.id],
    (err, attempt) => {
      if (err || !attempt)
        return res.status(404).json({ error: 'Attempt record not found.' });
      if (attempt.status === 'SUBMITTED')
        return res.status(400).json({ error: 'Already submitted.' });

      db.all(
        `SELECT sa.question_id, sa.student_response,
                q.correct_answer, q.default_marks, q.negative_marks
         FROM StudentAnswers sa
         JOIN Questions q ON sa.question_id = q.id
         WHERE sa.attempt_id = ?`,
        [attempt_id],
        (err, answers) => {
          if (err) return res.status(500).json({ error: err.message });

          let totalScore = 0;
          answers.forEach(ans => {
            if (ans.student_response &&
                ans.student_response.trim().toLowerCase() ===
                ans.correct_answer.trim().toLowerCase()) {
              totalScore += (ans.default_marks || 1);
            } else if (ans.student_response) {
              totalScore -= (ans.negative_marks || 0);
            }
          });

          db.run(
            `UPDATE ExamAttempts
             SET status='SUBMITTED', end_time=CURRENT_TIMESTAMP, total_score=?
             WHERE id=?`,
            [totalScore, attempt_id],
            (err) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ message: 'Exam submitted successfully', score: totalScore });
            }
          );
        }
      );
    }
  );
};

/* ── My results + profile ────────────────────────────────────── */
exports.getMyResults = (req, res) => {
  const studentId = req.user.id;

  db.get(
    `SELECT name, roll_number, branch, year, profile_photo
     FROM StudentProfiles WHERE student_id=?`,
    [studentId],
    (err, profile) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all(
        `SELECT ea.id, ea.exam_id,
                e.title AS exam_title,
                COALESCE(s.name,'General')  AS subject_name,
                COALESCE(s.color,'#4f46e5') AS subject_color,
                COALESCE(s.icon,'📚')       AS subject_icon,
                ea.status, ea.total_score,
                COALESCE(e.total_marks,100)  AS total_marks,
                COALESCE(e.pass_marks,40)    AS pass_marks,
                ea.start_time, ea.end_time
         FROM ExamAttempts ea
         JOIN Exams         e  ON ea.exam_id = e.id
         LEFT JOIN Subjects s  ON e.subject_id = s.id
         WHERE ea.student_id = ?
         ORDER BY ea.start_time DESC`,
        [studentId],
        (err, results) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ studentProfile: profile || {}, results: results || [] });
        }
      );
    }
  );
};

/* ── Subject-wise summary for student ───────────────────────── */
exports.getMySubjectProgress = (req, res) => {
  const studentId = req.user.id;
  db.all(
    `SELECT
       COALESCE(s.name,'General')      AS subject_name,
       COALESCE(s.color,'#4f46e5')     AS subject_color,
       COALESCE(s.icon,'📚')           AS subject_icon,
       COUNT(ea.id)                    AS total_exams,
       SUM(CASE WHEN ea.status='SUBMITTED' THEN 1 ELSE 0 END) AS submitted,
       ROUND(AVG(CASE WHEN ea.status='SUBMITTED'
                 THEN ea.total_score ELSE NULL END),1) AS avg_score,
       SUM(CASE WHEN ea.status='SUBMITTED'
                 AND ea.total_score >= COALESCE(ex.pass_marks,40)
                 THEN 1 ELSE 0 END) AS passed
     FROM ExamAttempts ea
     JOIN Exams         ex ON ea.exam_id   = ex.id
     LEFT JOIN Subjects s  ON ex.subject_id = s.id
     WHERE ea.student_id = ?
     GROUP BY COALESCE(s.name,'General'), s.color, s.icon
     ORDER BY subject_name`,
    [studentId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ subjects: rows || [] });
    }
  );
};

/* ── Register student (teacher-initiated) ───────────────────── */
exports.registerStudent = (req, res) => {
  const { name, email, roll_number, branch, year } = req.body;
  const bcrypt = require('bcryptjs');

  if (!name || !email || !roll_number)
    return res.status(400).json({ error: 'Name, email and roll number required.' });

  const defaultPassword = roll_number; // default pwd = roll number
  bcrypt.hash(defaultPassword, 10).then(hash => {
    const userId = uuidv4();
    db.run(
      `INSERT INTO Users (id, email, password_hash, role) VALUES (?,?,?,'STUDENT')`,
      [userId, email, hash],
      function (err) {
        if (err) return res.status(400).json({ error: 'Email already registered.' });
        db.run(
          `INSERT INTO StudentProfiles (student_id, name, roll_number, branch, year)
           VALUES (?,?,?,?,?)`,
          [userId, name, roll_number, branch || '', year || ''],
          function (err2) {
            if (err2) {
              db.run(`DELETE FROM Users WHERE id=?`, [userId]);
              return res.status(400).json({ error: 'Roll number already exists.' });
            }
            res.status(201).json({ message: 'Student registered', studentId: userId });
          }
        );
      }
    );
  });
};

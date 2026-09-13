const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { generateStudentPaper } = require('../utils/randomization');

/* ══════════════════════════════════════════════════════════════
   CREATE EXAM  (supports multiple question banks, 1-5)
   Body: { title, subject_id, banks: [{bank_id, selected_question_ids:[]}],
           duration_minutes, start_time, end_time,
           required_attempts_count, shuffle_questions, shuffle_options,
           proctoring_level, total_marks, pass_marks }
══════════════════════════════════════════════════════════════ */
exports.createExam = (req, res) => {
  const {
    title, subject_id,
    banks,                     // NEW: array of {bank_id, selected_question_ids}
    bank_id,                   // legacy single-bank support
    selected_question_ids,     // legacy
    duration_minutes, start_time, end_time,
    required_attempts_count,
    shuffle_questions, shuffle_options, proctoring_level,
    total_marks, pass_marks
  } = req.body;

  /* Normalise to multi-bank format */
  let bankList = banks && Array.isArray(banks) ? banks : [];
  if (!bankList.length && bank_id) {
    bankList = [{ bank_id, selected_question_ids: selected_question_ids || [] }];
  }
  if (!bankList.length)
    return res.status(400).json({ error: 'At least one question bank is required.' });
  if (bankList.length > 5)
    return res.status(400).json({ error: 'Maximum 5 question banks allowed per exam.' });

  const examId   = uuidv4();
  const examCode = Math.floor(100000 + Math.random() * 900000).toString();
  const poolSize = bankList.reduce((s, b) => s + (b.selected_question_ids || []).length, 0);

  /* Use first bank as primary bank_id for backward-compat */
  const primaryBankId = bankList[0].bank_id;

  db.run(
    `INSERT INTO Exams
      (id, code, teacher_id, title, subject_id, bank_id,
       duration_minutes, start_time, end_time,
       pool_size, required_attempts_count,
       shuffle_questions, shuffle_options, proctoring_level,
       selected_question_ids, total_marks, pass_marks, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    [
      examId, examCode, req.user.id, title,
      subject_id || null, primaryBankId,
      duration_minutes, start_time, end_time,
      poolSize || required_attempts_count || 0,
      required_attempts_count || 10,
      shuffle_questions ? 1 : 0,
      shuffle_options   ? 1 : 0,
      proctoring_level  || 'STRICT',
      JSON.stringify(bankList[0].selected_question_ids || []),
      total_marks || 100, pass_marks || 40
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      /* Insert ExamBanks junction rows */
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO ExamBanks (exam_id, bank_id, selected_question_ids)
         VALUES (?, ?, ?)`
      );
      bankList.forEach(b => {
        stmt.run(examId, b.bank_id, JSON.stringify(b.selected_question_ids || []));
      });
      stmt.finalize(() => {
        res.status(201).json({
          message: 'Exam created successfully',
          examId, examCode,
          accessLink: `${process.env.SERVER_URL || ''}/launch-exam?key=${examCode}`
        });
      });
    }
  );
};

/* ══════════════════════════════════════════════════════════════
   TOGGLE EXAM ACTIVE / INACTIVE
══════════════════════════════════════════════════════════════ */
exports.toggleExamStatus = (req, res) => {
  const { examId } = req.params;
  db.get(`SELECT id, is_active FROM Exams WHERE id=? AND teacher_id=?`,
    [examId, req.user.id], (err, exam) => {
      if (err || !exam) return res.status(404).json({ error: 'Exam not found.' });
      const newStatus = exam.is_active ? 0 : 1;
      db.run(`UPDATE Exams SET is_active=? WHERE id=?`, [newStatus, examId], function (e) {
        if (e) return res.status(500).json({ error: e.message });
        res.json({ message: newStatus ? 'Exam activated' : 'Exam deactivated', is_active: newStatus });
      });
    });
};

/* ══════════════════════════════════════════════════════════════
   START EXAM ATTEMPT  (checks is_active, merges multi-bank)
══════════════════════════════════════════════════════════════ */
exports.startExamAttempt = (req, res) => {
  const { exam_id } = req.body;
  const student_id  = req.user.id;

  db.get(`SELECT * FROM Exams WHERE (id=? OR code=?)`, [exam_id, exam_id], (err, exam) => {
    if (err || !exam)
      return res.status(404).json({ error: 'Exam not found or invalid access code.' });

    /* ── Check if exam is active ── */
    if (exam.is_active === 0)
      return res.status(403).json({
        error: 'This exam is currently inactive. Please contact your teacher.'
      });

    const internal_id = exam.id;

    db.get(`SELECT * FROM ExamAttempts WHERE exam_id=? AND student_id=?`,
      [internal_id, student_id], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing)
          return res.status(403).json({
            error: 'You have already appeared for this exam. Re-attempts are blocked.'
          });

        const attemptId = uuidv4();
        db.run(
          `INSERT INTO ExamAttempts (id, exam_id, student_id, status) VALUES (?,?,?,'IN_PROGRESS')`,
          [attemptId, internal_id, student_id],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });

            /* ── Collect questions from ALL linked banks ── */
            db.all(`SELECT * FROM ExamBanks WHERE exam_id=?`, [internal_id], (err, examBanks) => {
              if (err) return res.status(500).json({ error: err.message });

              /* Fall back to legacy single-bank if ExamBanks is empty */
              if (!examBanks || !examBanks.length) {
                examBanks = [{
                  bank_id: exam.bank_id,
                  selected_question_ids: exam.selected_question_ids || '[]'
                }];
              }

              const questionPromises = examBanks.map(eb => new Promise((resolve) => {
                let selectedIds = [];
                try { selectedIds = JSON.parse(eb.selected_question_ids || '[]'); } catch(e) {}

                if (selectedIds.length > 0) {
                  const ph = selectedIds.map(() => '?').join(',');
                  db.all(
                    `SELECT id, question_text, question_type, options, default_marks
                     FROM Questions WHERE id IN (${ph})`,
                    selectedIds, (err, rows) => resolve(rows || [])
                  );
                } else {
                  db.all(
                    `SELECT id, question_text, question_type, options, default_marks
                     FROM Questions WHERE bank_id=?`,
                    [eb.bank_id], (err, rows) => resolve(rows || [])
                  );
                }
              }));

              Promise.all(questionPromises).then(results => {
                const allQuestions = results.flat();
                if (!allQuestions.length)
                  return res.status(400).json({ error: 'No questions available in this exam pool.' });

                const paper = generateStudentPaper(
                  allQuestions,
                  exam.required_attempts_count || allQuestions.length,
                  student_id, internal_id,
                  Boolean(exam.shuffle_options)
                );

                const stmt = db.prepare(
                  `INSERT INTO AssignedQuestions
                     (attempt_id, question_id, sequence_order, shuffled_options)
                   VALUES (?,?,?,?)`
                );
                paper.forEach(item =>
                  stmt.run(attemptId, item.id, item.sequence_order, item.shuffled_options)
                );
                stmt.finalize(err => {
                  if (err) return res.status(500).json({ error: err.message });
                  res.json({
                    attemptId,
                    duration_minutes: exam.duration_minutes,
                    title: exam.title,
                    questions: paper.map(q => ({
                      id: q.id,
                      question_text: q.question_text,
                      question_type: q.question_type,
                      sequence_order: q.sequence_order,
                      options: typeof q.shuffled_options === 'string'
                        ? JSON.parse(q.shuffled_options)
                        : (q.options || [])
                    }))
                  });
                });
              });
            });
          }
        );
      });
  });
};

/* ══════════════════════════════════════════════════════════════
   ANNOUNCEMENTS
══════════════════════════════════════════════════════════════ */
exports.sendAnnouncement = (req, res) => {
  const { exam_id, message, target_student_id, type } = req.body;
  if (!exam_id || !message)
    return res.status(400).json({ error: 'exam_id and message are required.' });

  db.run(
    `INSERT INTO Announcements (exam_id, teacher_id, target_student_id, message, type)
     VALUES (?,?,?,?,?)`,
    [exam_id, req.user.id, target_student_id || null,
     message, type || (target_student_id ? 'INDIVIDUAL' : 'BROADCAST')],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      /* Push via WebSocket */
      try {
        const { getIO } = require('../utils/websocketHandler');
        const io = getIO();
        const payload = { message, type: type || 'BROADCAST', timestamp: new Date() };
        if (target_student_id) {
          io.to(`student:${target_student_id}`).emit('announcement', payload);
        } else {
          io.to(`exam:${exam_id}`).emit('announcement', payload);
        }
      } catch(e) { /* socket optional */ }

      res.json({ message: 'Announcement sent', id: this.lastID });
    }
  );
};

exports.getAnnouncements = (req, res) => {
  db.all(
    `SELECT * FROM Announcements WHERE exam_id=? ORDER BY created_at DESC LIMIT 50`,
    [req.params.examId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ announcements: rows || [] });
    }
  );
};

/* ══════════════════════════════════════════════════════════════
   GET EXAMS LIST (with active status + subject info)
══════════════════════════════════════════════════════════════ */
exports.getExamsList = (req, res) => {
  const teacherId = req.user.id;
  db.all(
    `SELECT e.*,
            COALESCE(s.name,'—')  AS subject_name,
            COALESCE(s.color,'#4f46e5') AS subject_color,
            COUNT(DISTINCT ea.id) AS attempt_count
     FROM Exams e
     LEFT JOIN Subjects     s  ON s.id = e.subject_id
     LEFT JOIN ExamAttempts ea ON ea.exam_id = e.id
     WHERE e.teacher_id = ?
     GROUP BY e.id
     ORDER BY e.created_at DESC`,
    [teacherId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ exams: rows || [] });
    }
  );
};

/* ══════════════════════════════════════════════════════════════
   GET BANKS for exam (multi-bank aware)
══════════════════════════════════════════════════════════════ */
exports.getExamBanks = (req, res) => {
  db.all(
    `SELECT eb.*, qb.title AS bank_title, qb.subject_id,
            COUNT(q.id) AS total_questions
     FROM ExamBanks eb
     JOIN QuestionBanks qb ON qb.id = eb.bank_id
     LEFT JOIN Questions  q  ON q.bank_id = eb.bank_id
     WHERE eb.exam_id = ?
     GROUP BY eb.bank_id`,
    [req.params.examId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ banks: rows || [] });
    }
  );
};

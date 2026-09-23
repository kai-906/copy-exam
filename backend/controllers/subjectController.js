const db    = require('../db');
const { randomUUID: uuidv4 } = require('crypto');

/* ── Palette of default class colors (Google-Classroom style) ── */
const DEFAULT_COLORS = [
  '#4f46e5','#0284c7','#059669','#d97706',
  '#dc2626','#7c3aed','#db2777','#0891b2'
];
const DEFAULT_ICONS = ['📚','🔬','📐','🌍','💻','🧪','📝','🎯'];

/* GET /api/subjects  — teacher's subjects list */
exports.getSubjects = (req, res) => {
  const teacherId = req.user.id;
  db.all(
    `SELECT s.*,
            (SELECT COUNT(*) FROM QuestionBanks qb WHERE qb.subject_id = s.id) AS bank_count,
            (SELECT COUNT(*) FROM Exams e WHERE e.subject_id = s.id) AS exam_count
     FROM Subjects s
     WHERE s.teacher_id = ?
     ORDER BY s.created_at DESC`,
    [teacherId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ subjects: rows || [] });
    }
  );
};

/* POST /api/subjects */
exports.createSubject = (req, res) => {
  const teacherId = req.user.id;
  const { name, description, color, icon } = req.body;
  if (!name || !name.trim())
    return res.status(400).json({ error: 'Subject name is required.' });

  const id = uuidv4();
  const idx = Math.floor(Math.random() * DEFAULT_COLORS.length);
  db.run(
    `INSERT INTO Subjects (id, teacher_id, name, description, color, icon)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, teacherId, name.trim(), description || '', color || DEFAULT_COLORS[idx], icon || DEFAULT_ICONS[idx]],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE') || err.code === '23505' || err.message.toLowerCase().includes('unique constraint'))
          return res.status(400).json({ error: 'A class with this name already exists' });
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ message: 'Subject created', subjectId: id });
    }
  );
};

/* PUT /api/subjects/:id */
exports.updateSubject = (req, res) => {
  const { name, description, color, icon } = req.body;
  db.run(
    `UPDATE Subjects SET name=?, description=?, color=?, icon=? WHERE id=? AND teacher_id=?`,
    [name, description, color, icon, req.params.id, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: 'Subject not found or not yours.' });
      res.json({ message: 'Subject updated' });
    }
  );
};

/* DELETE /api/subjects/:id */
exports.deleteSubject = (req, res) => {
  const teacherId = req.user.id;
  /* Unlink banks & exams from this subject first (soft unlink) */
  db.run(`UPDATE QuestionBanks SET subject_id=NULL WHERE subject_id=? AND teacher_id=?`,
    [req.params.id, teacherId], () => {});
  db.run(`UPDATE Exams SET subject_id=NULL WHERE subject_id=? AND teacher_id=?`,
    [req.params.id, teacherId], () => {});
  db.run(
    `DELETE FROM Subjects WHERE id=? AND teacher_id=?`,
    [req.params.id, teacherId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: 'Subject not found.' });
      res.json({ message: 'Subject deleted' });
    }
  );
};

/* GET /api/subjects/:id/banks  — banks belonging to a subject */
exports.getSubjectBanks = (req, res) => {
  db.all(
    `SELECT qb.*,
            (SELECT COUNT(*) FROM Questions q WHERE q.bank_id = qb.id) AS question_count
     FROM QuestionBanks qb
     WHERE qb.subject_id = ? AND qb.teacher_id = ?
     ORDER BY qb.created_at DESC`,
    [req.params.id, req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ banks: rows || [] });
    }
  );
};

/* GET /api/subjects/:id/exams */
exports.getSubjectExams = (req, res) => {
  db.all(
    `SELECT e.*,
            (SELECT COUNT(*) FROM ExamAttempts ea WHERE ea.exam_id = e.id) AS attempt_count
     FROM Exams e
     WHERE e.subject_id = ? AND e.teacher_id = ?
     ORDER BY e.created_at DESC`,
    [req.params.id, req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ exams: rows || [] });
    }
  );
};

/* ── Teacher profile ─────────────────────────────────────────── */
exports.getTeacherProfile = (req, res) => {
  const teacherId = req.user.id;
  db.get(
    `SELECT tp.*, u.email
     FROM Users u
     LEFT JOIN TeacherProfiles tp ON tp.teacher_id = u.id
     WHERE u.id = ?`,
    [teacherId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ profile: row || { email: req.user.email, name: 'Teacher', teacher_id: teacherId } });
    }
  );
};

exports.upsertTeacherProfile = (req, res) => {
  const teacherId = req.user.id;
  const { name, profile_photo, department } = req.body;
  db.run(
    `INSERT INTO TeacherProfiles (teacher_id, name, profile_photo, department)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(teacher_id) DO UPDATE SET
       name=excluded.name,
       profile_photo=excluded.profile_photo,
       department=excluded.department`,
    [teacherId, name || 'Teacher', profile_photo || null, department || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Profile saved' });
    }
  );
};

require('dotenv').config();

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');

const authController    = require('./controllers/authController');
const bankController    = require('./controllers/bankController');
const examController    = require('./controllers/examController');
const studentController = require('./controllers/studentController');
const teacherController = require('./controllers/teacherController');
const subjectController = require('./controllers/subjectController');
const reportController  = require('./controllers/reportController');
const proctorController = require('./controllers/proctorController');

const { verifyToken, requireRole } = require('./middleware/auth');
const upload = require('./middleware/upload');
const websocketHandler = require('./utils/websocketHandler');

const app    = express();
const server = http.createServer(app);

const missingHandler = (name) => (req, res) =>
  res.status(501).json({ error: `Handler '${name}' not yet implemented` });

if (websocketHandler && typeof websocketHandler.init === 'function') {
  websocketHandler.init(server);
}

app.use(compression());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

/* ── Static files ─────────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/student-app', express.static(path.join(__dirname, 'student-app')));
app.use('/downloads',   express.static(path.join(__dirname, 'public', 'downloads')));

/* ── Auth ─────────────────────────────────────────────────────── */
app.post('/api/auth/teacher/register', authController.registerTeacher);
app.post('/api/auth/teacher/login',    authController.loginTeacher);
app.post('/api/auth/student/register', authController.registerStudent);
app.post('/api/auth/student/login',    authController.loginStudent);
app.post('/api/auth/forgot-password',  authController.forgotPassword);
app.post('/api/auth/verify-otp',       authController.verifyOTP);
app.post('/api/auth/reset-password',   authController.resetPassword);
app.post('/api/student/register',      authController.registerStudent);
app.post('/api/student/login',         authController.loginStudent);

/* ── Teacher profile ──────────────────────────────────────────── */
app.get ('/api/teacher/profile', verifyToken, requireRole('TEACHER'), subjectController.getTeacherProfile);
app.post('/api/teacher/profile', verifyToken, requireRole('TEACHER'), subjectController.upsertTeacherProfile);

/* ── Subjects ─────────────────────────────────────────────────── */
app.get   ('/api/subjects',                verifyToken, requireRole('TEACHER'), subjectController.getSubjects);
app.post  ('/api/subjects',                verifyToken, requireRole('TEACHER'), subjectController.createSubject);
app.put   ('/api/subjects/:id',            verifyToken, requireRole('TEACHER'), subjectController.updateSubject);
app.delete('/api/subjects/:id',            verifyToken, requireRole('TEACHER'), subjectController.deleteSubject);
app.get   ('/api/subjects/:id/banks',      verifyToken, requireRole('TEACHER'), subjectController.getSubjectBanks);
app.get   ('/api/subjects/:id/exams',      verifyToken, requireRole('TEACHER'), subjectController.getSubjectExams);

/* ── Question Banks ───────────────────────────────────────────── */
const handleUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'File upload error.' });
    next();
  });
};

app.post  ('/api/banks/upload',              verifyToken, requireRole('TEACHER'), handleUpload, bankController.uploadBank);
app.get   ('/api/banks',                     verifyToken, requireRole('TEACHER'), bankController.getTeacherBanks);
app.get   ('/api/banks/:id/questions',       verifyToken, requireRole('TEACHER'), bankController.getBankQuestions);
app.delete('/api/banks/:id',                 verifyToken, requireRole('TEACHER'), bankController.deleteQuestionBank);
app.post  ('/api/banks/:bankId/append-file', verifyToken, requireRole('TEACHER'), handleUpload, bankController.appendFileToBank);

/* ── Questions ────────────────────────────────────────────────── */
app.put   ('/api/banks/questions/:id',     verifyToken, requireRole('TEACHER'), bankController.updateQuestion);
app.post  ('/api/banks/questions/manual',  verifyToken, requireRole('TEACHER'), bankController.addQuestionManual);
app.delete('/api/banks/questions/:id',     verifyToken, requireRole('TEACHER'), bankController.deleteQuestion);

/* ── Exams ────────────────────────────────────────────────────── */
app.post  ('/api/exams/create',                  verifyToken, requireRole('TEACHER'), examController.createExam);
app.get   ('/api/exams',                         verifyToken, requireRole('TEACHER'), examController.getExamsList);
app.patch ('/api/exams/:examId/toggle',          verifyToken, requireRole('TEACHER'), examController.toggleExamStatus);
app.get   ('/api/exams/:examId/banks',           verifyToken, requireRole('TEACHER'), examController.getExamBanks);
app.post  ('/api/exams/announce',                verifyToken, requireRole('TEACHER'), examController.sendAnnouncement);
app.get   ('/api/exams/:examId/announcements',   verifyToken, requireRole('TEACHER'), examController.getAnnouncements);

/* ── Teacher dashboard aliases ────────────────────────────────── */
app.get ('/api/teacher/exams',                verifyToken, requireRole('TEACHER'), examController.getExamsList);
app.get ('/api/teacher/students',             verifyToken, requireRole('TEACHER'), teacherController.getRegisteredStudents);
app.post('/api/teacher/students/register',    verifyToken, requireRole('TEACHER'), studentController.registerStudent);
app.get ('/api/teacher/results',              verifyToken, requireRole('TEACHER'), teacherController.getExamResultsList);
app.get ('/api/teacher/results/:examId',      verifyToken, requireRole('TEACHER'), teacherController.getExamResults);
app.get ('/api/teacher/exam-results/:examId', verifyToken, requireRole('TEACHER'), teacherController.getExamResults);
app.get ('/api/teacher/subject-results',      verifyToken, requireRole('TEACHER'), (req, res) => {
  const db = require('./db');
  db.all(
    `SELECT COALESCE(s.name,'General') AS subject_name,
            COALESCE(s.color,'#4f46e5') AS subject_color,
            COALESCE(s.icon,'📚')       AS subject_icon,
            COUNT(DISTINCT ea.id)       AS total_attempts,
            COUNT(DISTINCT e.id)        AS total_exams,
            ROUND(AVG(CASE WHEN ea.status='SUBMITTED' THEN ea.total_score END),1) AS avg_score,
            SUM(CASE WHEN ea.status='SUBMITTED' AND ea.total_score>=COALESCE(e.pass_marks,40) THEN 1 ELSE 0 END) AS passed
     FROM Exams e
     LEFT JOIN Subjects     s  ON s.id  = e.subject_id
     LEFT JOIN ExamAttempts ea ON ea.exam_id = e.id
     WHERE e.teacher_id=?
     GROUP BY COALESCE(s.name,'General')
     ORDER BY subject_name`,
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ subjects: rows || [] });
    }
  );
});

/* ── Proctoring ───────────────────────────────────────────────── */
app.post('/api/proctor/log-violation', verifyToken, proctorController.logViolation);
app.post('/api/proctor/verify-face',   verifyToken, proctorController.verifyFace);
app.get ('/api/proctor/logs/:examId',  verifyToken, requireRole('TEACHER'), (req, res) => {
  const db = require('./db');
  db.all(
    `SELECT pl.*, sp.name AS student_name, sp.roll_number
     FROM ProctorLogs pl
     JOIN Users u ON pl.student_id = u.id
     LEFT JOIN StudentProfiles sp ON sp.student_id = u.id
     WHERE pl.student_id IN (SELECT student_id FROM ExamAttempts WHERE exam_id=?)
     ORDER BY pl.timestamp DESC LIMIT 200`,
    [req.params.examId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ logs: rows || [] });
    }
  );
});

/* ── Live exam attendees list ──────────────────────────────────── */
app.get('/api/proctor/live/:examId', verifyToken, requireRole('TEACHER'), (req, res) => {
  const db = require('./db');
  db.all(
    `SELECT ea.id AS attempt_id, ea.student_id, ea.status, ea.start_time,
            sp.name, sp.roll_number, sp.profile_photo
     FROM ExamAttempts ea
     JOIN StudentProfiles sp ON sp.student_id = ea.student_id
     WHERE ea.exam_id=? AND ea.status='IN_PROGRESS'
     ORDER BY ea.start_time DESC`,
    [req.params.examId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ students: rows || [] });
    }
  );
});

/* ── Public exam-info (no auth required — used by app-launcher) ─ */
app.get('/api/exams/public-info/:codeOrId', examController.getPublicExamInfo);

/* ── Student CBT ──────────────────────────────────────────────── */
app.post('/api/attempts/start',              verifyToken, requireRole('STUDENT'), examController.startExamAttempt);
app.post('/api/exams/verify-eligibility',    verifyToken, requireRole('STUDENT'), examController.verifyExamEligibility);
app.post('/api/attempts/save-answer',        verifyToken, requireRole('STUDENT'), studentController.saveAnswer);
app.post('/api/attempts/submit',             verifyToken, requireRole('STUDENT'), studentController.submitExam);
app.get ('/api/student/my-results',          verifyToken, requireRole('STUDENT'), studentController.getMyResults);
app.get ('/api/attempts/my-results',         verifyToken, requireRole('STUDENT'), studentController.getMyResults);
app.get ('/api/student/subject-progress',    verifyToken, requireRole('STUDENT'), studentController.getMySubjectProgress);

/* ── Analytics ────────────────────────────────────────────────── */
app.get('/api/reports/exam/:examId',        verifyToken, requireRole('TEACHER'), reportController.getExamAnalytics   || missingHandler('getExamAnalytics'));
app.get('/api/reports/exam/:examId/export', verifyToken, requireRole('TEACHER'), reportController.exportResultsFormat || missingHandler('exportResultsFormat'));

/* ── Student portal convenience redirects ─────────────────────── */
app.get(['/student', '/student/'], (req, res) =>
  res.redirect('/student-app/renderer/index.html'));
app.get(['/student-app', '/student-app/'], (req, res) =>
  res.redirect('/student-app/renderer/index.html'));
app.get(['/student/login', '/student/login/'], (req, res) =>
  res.redirect('/student-app/renderer/index.html'));
app.get(['/student/dashboard', '/student/dashboard/'], (req, res) =>
  res.redirect('/student-app/renderer/dashboard.html'));
app.get(['/student/register', '/student/register/'], (req, res) =>
  res.redirect('/student-app/renderer/register.html'));

/* ── Deep link + downloads ────────────────────────────────────── */
app.get('/launch-exam', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'app-launcher.html')));

const WINDOWS_EXE_URL = 'https://github.com/kai-906/copy-exam/releases/download/v1.0.0/student-app.exe';

app.get('/downloads/app-release.apk', (req, res) => {
  const p = path.join(__dirname, 'public', 'downloads', 'app-release.apk');
  if (fs.existsSync(p) && fs.statSync(p).size > 100000) {
    return res.download(p, 'SmartExam-Student.apk');
  }
  return res.status(404).json({ error: 'APK not yet available.' });
});

app.get(['/download/student-app', '/downloads/student-app.exe'], (req, res) => {
  const p = path.join(__dirname, 'public', 'downloads', 'student-app.exe');
  if (fs.existsSync(p) && fs.statSync(p).size > 1000000) {
    return res.download(p, 'Smart-Exam-Student-App.exe');
  }
  return res.redirect(WINDOWS_EXE_URL);
});

/* ── Start ────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`🚀  Smart Exam System  ·  port ${PORT}`);
  console.log(`    Teacher  : http://localhost:${PORT}/teacher/login.html`);
  console.log(`    Student  : http://localhost:${PORT}/student-app/renderer/index.html`);
  console.log(`${'═'.repeat(52)}\n`);
});

require('dotenv').config();   // loads .env file in development / production

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');

const authController = require('./controllers/authController');
const bankController = require('./controllers/bankController');
const examController = require('./controllers/examController');
const studentController = require('./controllers/studentController');
const teacherController = require('./controllers/teacherController');
const reportController = require('./controllers/reportController');
const proctorController = require('./controllers/proctorController');

const { verifyToken, requireRole } = require('./middleware/auth');
const upload = require('./middleware/upload');
const websocketHandler = require('./utils/websocketHandler');

const app = express();
const server = http.createServer(app);

// Safe Dummy Fallback Handler if any controller function is missing
const missingHandler = (name) => (req, res) =>
  res.status(500).json({
    error: `Handler ${name} is not defined in controller`
  });

// Initialize Socket.io Server
if (websocketHandler && typeof websocketHandler.init === 'function') {
  websocketHandler.init(server);
}

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Static Files Routes
app.use(express.static(path.join(__dirname, 'public')));
app.use('/student-app', express.static(path.join(__dirname, 'student-app')));
app.use('/downloads', express.static(path.join(__dirname, 'public', 'downloads')));

// Auth Routes
app.post(
  '/api/auth/teacher/register',
  authController.registerTeacher || missingHandler('registerTeacher')
);

app.post(
  '/api/auth/teacher/login',
  authController.loginTeacher || missingHandler('loginTeacher')
);

app.post(
  '/api/auth/student/register',
  authController.registerStudent || missingHandler('registerStudent')
);

app.post(
  '/api/auth/student/login',
  authController.loginStudent || missingHandler('loginStudent')
);

app.post(
  '/api/auth/forgot-password',
  authController.forgotPassword || missingHandler('forgotPassword')
);

app.post(
  '/api/auth/reset-password',
  authController.resetPassword || missingHandler('resetPassword')
);

// Question Bank Routes
const handleUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.message || 'File upload error.'
      });
    }
    next();
  });
};

app.post(
  '/api/banks/upload',
  verifyToken,
  requireRole('TEACHER'),
  handleUpload,
  bankController.uploadBank || missingHandler('uploadBank')
);

app.get(
  '/api/banks',
  verifyToken,
  requireRole('TEACHER'),
  bankController.getTeacherBanks ||
    bankController.getBanks ||
    missingHandler('getTeacherBanks')
);

app.get(
  '/api/banks/:id/questions',
  verifyToken,
  requireRole('TEACHER'),
  bankController.getBankQuestions || missingHandler('getBankQuestions')
);

app.delete(
  '/api/banks/:id',
  verifyToken,
  requireRole('TEACHER'),
  bankController.deleteQuestionBank ||
    bankController.deleteBank ||
    missingHandler('deleteQuestionBank')
);

// Question Bank Editor Routes
app.put(
  '/api/banks/questions/:id',
  verifyToken,
  requireRole('TEACHER'),
  bankController.updateQuestion || missingHandler('updateQuestion')
);

app.post(
  '/api/banks/questions/manual',
  verifyToken,
  requireRole('TEACHER'),
  bankController.addQuestionManual || missingHandler('addQuestionManual')
);

app.delete(
  '/api/banks/questions/:id',
  verifyToken,
  requireRole('TEACHER'),
  bankController.deleteQuestion || missingHandler('deleteQuestion')
);

// Fixed Route URL for PDF Append feature
app.post(
  '/api/banks/:bankId/append-file',
  verifyToken,
  requireRole('TEACHER'),
  handleUpload,
  bankController.appendFileToBank || missingHandler('appendFileToBank')
);

// Exam Management Routes
app.post(
  '/api/exams/create',
  verifyToken,
  requireRole('TEACHER'),
  examController.createExam ||
    examController.addExam ||
    missingHandler('createExam')
);

// Teacher Dashboard & Results Routes
app.get(
  '/api/teacher/exams',
  verifyToken,
  requireRole('TEACHER'),
  teacherController.getExamsList || missingHandler('getExamsList')
);

app.get(
  '/api/teacher/students',
  verifyToken,
  requireRole('TEACHER'),
  teacherController.getRegisteredStudents ||
    missingHandler('getRegisteredStudents')
);

app.post(
  '/api/teacher/students/register',
  verifyToken,
  requireRole('TEACHER'),
  studentController.registerStudent ||
    teacherController.registerStudentManual ||
    missingHandler('registerStudent')
);

app.get(
  '/api/teacher/results',
  verifyToken,
  requireRole('TEACHER'),
  teacherController.getExamResultsList ||
    teacherController.getExamResults ||
    missingHandler('getExamResults')
);

app.get(
  '/api/teacher/results/:examId',
  verifyToken,
  requireRole('TEACHER'),
  teacherController.getExamResults || missingHandler('getExamResults')
);

app.get(
  '/api/teacher/exam-results/:examId',
  verifyToken,
  requireRole('TEACHER'),
  teacherController.getExamResults || missingHandler('getExamResults')
);

// Student Registration Alias Route
app.post(
  '/api/student/register',
  authController.registerStudent || missingHandler('registerStudent')
);

// Proctoring & Anti-Cheating Routes
app.post(
  '/api/proctor/log-violation',
  verifyToken,
  proctorController.logViolation ||
    ((req, res) => res.json({ success: true }))
);

app.post(
  '/api/proctor/verify-face',
  verifyToken,
  proctorController.verifyFace ||
    ((req, res) => res.json({ verified: true }))
);

// Student CBT Exam Routes
app.post(
  '/api/attempts/start',
  verifyToken,
  requireRole('STUDENT'),
  examController.startExamAttempt ||
    missingHandler('startExamAttempt')
);

app.post(
  '/api/attempts/save-answer',
  verifyToken,
  requireRole('STUDENT'),
  studentController.saveAnswer || missingHandler('saveAnswer')
);

app.post(
  '/api/attempts/submit',
  verifyToken,
  requireRole('STUDENT'),
  studentController.submitExam || missingHandler('submitExam')
);

app.get(
  '/api/student/my-results',
  verifyToken,
  requireRole('STUDENT'),
  studentController.getMyResults || missingHandler('getMyResults')
);

app.get(
  '/api/attempts/my-results',
  verifyToken,
  requireRole('STUDENT'),
  studentController.getMyResults || missingHandler('getMyResults')
);

// Analytics & Export Routes
app.get(
  '/api/reports/exam/:examId',
  verifyToken,
  requireRole('TEACHER'),
  reportController.getExamAnalytics ||
    missingHandler('getExamAnalytics')
);

app.get(
  '/api/reports/exam/:examId/export',
  verifyToken,
  requireRole('TEACHER'),
  reportController.exportResultsFormat ||
    missingHandler('exportResultsFormat')
);

// Deep Link Launcher Route
app.get('/launch-exam', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app-launcher.html'));
});

// ==========================================================
// APP DOWNLOAD ROUTES
// ==========================================================

// Android APK
app.get('/downloads/app-release.apk', (req, res) => {
  const filePath = path.join(
    __dirname,
    'public',
    'downloads',
    'app-release.apk'
  );

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100000) {
    res.download(filePath, 'SmartExam-Student.apk');
  } else {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Android App — Smart Exam</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>

<body class="bg-slate-900 min-h-screen flex items-center justify-center p-6">

<div class="max-w-md w-full text-center space-y-5">

<div class="text-6xl">📱</div>

<h1 class="text-2xl font-bold text-white">
Android App
</h1>

<p class="text-slate-400 text-sm">
The Smart Exam Android APK is currently being built.
</p>

<div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-left space-y-2">

<p class="text-amber-400 text-xs font-bold uppercase tracking-wider">
To install on Android:
</p>

<ol class="text-amber-300 text-xs space-y-1 list-decimal list-inside">

<li>
Build the APK using Capacitor + Android Studio
</li>

<li>
Enable <strong>Install Unknown Apps</strong> in Android Settings
</li>

<li>
Place the .apk in
<code class="bg-slate-800 px-1 rounded">
public/downloads/app-release.apk
</code>
</li>

<li>
The download link will then serve the real APK
</li>

</ol>

</div>

<a
href="/download/student-app"
class="inline-block bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-6 rounded-xl text-sm mt-2"
>
⬇️ Download Windows App Instead
</a>

</div>

</body>
</html>`);
  }
});

// ==========================================================
// WINDOWS EXE DOWNLOAD
// EXE is hosted in GitHub Release because it is ~309 MB.
// ==========================================================

app.get('/download/student-app', (req, res) => {
  res.redirect(
    'https://github.com/kai-906/copy-exam/releases/download/v1.0.0/student-app.exe'
  );
});

// ==========================================================
// START SERVER
// ==========================================================

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`
==================================================
🚀 Smart Exam System Server Running!
👉 Teacher Portal : http://localhost:${PORT}/teacher/login.html
👉 Student Portal : http://localhost:${PORT}/student-app/renderer/index.html
==================================================
`);
});
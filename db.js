const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, 'exam_system.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`PRAGMA journal_mode = WAL;`);
  db.run(`PRAGMA synchronous = NORMAL;`);

  db.run(`
    CREATE TABLE IF NOT EXISTS Users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('TEACHER', 'STUDENT')) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS StudentProfiles (
      student_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      roll_number TEXT UNIQUE NOT NULL,
      branch TEXT NOT NULL,
      year TEXT NOT NULL,
      reference_face_descriptor TEXT,
      FOREIGN KEY(student_id) REFERENCES Users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS QuestionBanks (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(teacher_id) REFERENCES Users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS Questions (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      question_text TEXT NOT NULL,
      question_type TEXT CHECK(question_type IN ('MCQ', 'FILL_BLANK', 'SHORT_ANSWER')) NOT NULL,
      options TEXT,
      correct_answer TEXT NOT NULL,
      explanation TEXT,
      difficulty TEXT CHECK(difficulty IN ('EASY', 'MEDIUM', 'HARD')) DEFAULT 'MEDIUM',
      default_marks REAL DEFAULT 1.0,
      negative_marks REAL DEFAULT 0.0,
      FOREIGN KEY(bank_id) REFERENCES QuestionBanks(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS Exams (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL,
      title TEXT NOT NULL,
      bank_id TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      pool_size INTEGER NOT NULL,
      required_attempts_count INTEGER NOT NULL,
      shuffle_questions BOOLEAN DEFAULT 1,
      shuffle_options BOOLEAN DEFAULT 1,
      proctoring_level TEXT CHECK(proctoring_level IN ('OFF', 'LOW', 'STRICT')) DEFAULT 'STRICT',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(teacher_id) REFERENCES Users(id),
      FOREIGN KEY(bank_id) REFERENCES QuestionBanks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ExamAttempts (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT CHECK(status IN ('IN_PROGRESS', 'SUBMITTED', 'TERMINATED')) DEFAULT 'IN_PROGRESS',
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      total_score REAL DEFAULT 0.0,
      FOREIGN KEY(exam_id) REFERENCES Exams(id),
      FOREIGN KEY(student_id) REFERENCES Users(id),
      UNIQUE(exam_id, student_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS AssignedQuestions (
      attempt_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      sequence_order INTEGER NOT NULL,
      shuffled_options TEXT,
      PRIMARY KEY(attempt_id, question_id),
      FOREIGN KEY(attempt_id) REFERENCES ExamAttempts(id) ON DELETE CASCADE,
      FOREIGN KEY(question_id) REFERENCES Questions(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS StudentAnswers (
      attempt_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      student_response TEXT,
      is_marked_for_review BOOLEAN DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(attempt_id, question_id),
      FOREIGN KEY(attempt_id) REFERENCES ExamAttempts(id) ON DELETE CASCADE,
      FOREIGN KEY(question_id) REFERENCES Questions(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ProctorLogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      violation_type TEXT NOT NULL,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(student_id) REFERENCES Users(id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON Users(email);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_student_roll ON StudentProfiles(roll_number);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_questions_bank ON Questions(bank_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_assigned_attempt ON AssignedQuestions(attempt_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_answers_attempt ON StudentAnswers(attempt_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_proctor_student ON ProctorLogs(student_id);`);

  // ── Subjects table ────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS Subjects (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#4f46e5',
      icon TEXT DEFAULT '📚',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(teacher_id) REFERENCES Users(id) ON DELETE CASCADE,
      UNIQUE(teacher_id, name)
    )
  `);

  // ── Exam ↔ multiple question banks ────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS ExamBanks (
      exam_id TEXT NOT NULL,
      bank_id TEXT NOT NULL,
      selected_question_ids TEXT DEFAULT '[]',
      PRIMARY KEY(exam_id, bank_id),
      FOREIGN KEY(exam_id) REFERENCES Exams(id) ON DELETE CASCADE,
      FOREIGN KEY(bank_id) REFERENCES QuestionBanks(id) ON DELETE CASCADE
    )
  `);

  // ── Exam announcements ────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS Announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id TEXT NOT NULL,
      teacher_id TEXT NOT NULL,
      target_student_id TEXT,
      message TEXT NOT NULL,
      type TEXT CHECK(type IN ('BROADCAST','INDIVIDUAL')) DEFAULT 'BROADCAST',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(exam_id) REFERENCES Exams(id) ON DELETE CASCADE
    )
  `);

  // ── Teacher profiles ──────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS TeacherProfiles (
      teacher_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Teacher',
      profile_photo TEXT,
      department TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(teacher_id) REFERENCES Users(id) ON DELETE CASCADE
    )
  `);

  // ── Safe non-destructive column migrations ────────────────────
  db.run(`ALTER TABLE Exams ADD COLUMN selected_question_ids TEXT`, () => {});
  db.run(`ALTER TABLE Exams ADD COLUMN code TEXT`, () => {});
  db.run(`ALTER TABLE Exams ADD COLUMN total_marks REAL DEFAULT 100`, () => {});
  db.run(`ALTER TABLE Exams ADD COLUMN pass_marks REAL DEFAULT 40`, () => {});
  db.run(`ALTER TABLE Exams ADD COLUMN is_active INTEGER DEFAULT 1`, () => {});
  db.run(`ALTER TABLE Exams ADD COLUMN subject_id TEXT`, () => {});
  db.run(`ALTER TABLE Questions ADD COLUMN image_url TEXT`, () => {});
  db.run(`ALTER TABLE StudentProfiles ADD COLUMN profile_photo TEXT`, () => {});
  db.run(`ALTER TABLE Users ADD COLUMN reset_token TEXT`, () => {});
  db.run(`ALTER TABLE Users ADD COLUMN reset_token_expiry DATETIME`, () => {});
  db.run(`ALTER TABLE Users ADD COLUMN otp_code TEXT`, () => {});
  db.run(`ALTER TABLE Users ADD COLUMN otp_expiry DATETIME`, () => {});
  db.run(`ALTER TABLE QuestionBanks ADD COLUMN subject_id TEXT`, () => {});

  db.run(`CREATE INDEX IF NOT EXISTS idx_subjects_teacher ON Subjects(teacher_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_exambanks_exam ON ExamBanks(exam_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_announcements_exam ON Announcements(exam_id);`);
});

module.exports = db;
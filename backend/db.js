const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/exam_system',
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') ? { rejectUnauthorized: false } : false
});

function convertQuery(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

const db = {
  run: function(sql, params = [], callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    let runSql = convertQuery(sql);
    const isInsert = runSql.trim().toUpperCase().startsWith('INSERT');
    if (isInsert && !runSql.toUpperCase().includes('RETURNING')) {
      runSql += ' RETURNING *';
    }

    pool.query(runSql, params)
      .then(result => {
        const context = {
          changes: result.rowCount,
          lastID: (result.rows && result.rows.length > 0) ? (result.rows[0].id || result.rows[0].attempt_id || result.rows[0].exam_id || null) : null
        };
        if (callback) callback.call(context, null);
      })
      .catch(err => {
        if (callback) callback.call(this, err);
      });
    return this;
  },
  get: function(sql, params = [], callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    pool.query(convertQuery(sql), params)
      .then(result => {
        if (callback) callback(null, result.rows[0]);
      })
      .catch(err => {
        if (callback) callback(err);
      });
    return this;
  },
  all: function(sql, params = [], callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    pool.query(convertQuery(sql), params)
      .then(result => {
        if (callback) callback(null, result.rows);
      })
      .catch(err => {
        if (callback) callback(err);
      });
    return this;
  },
  serialize: function(callback) {
    callback();
  },
  /**
   * Safety shim: db.prepare() is a SQLite-only API.
   * This shim prevents "db.prepare is not a function" crashes
   * by returning an object with run() and finalize() that delegate
   * to the standard db.run() adapter.
   */
  prepare: function(sql) {
    console.warn('[DB] DEPRECATION: db.prepare() called — use db.run() instead. SQL:', sql.substring(0, 80));
    const self = this;
    return {
      run: function(...args) {
        self.run(sql, args);
      },
      finalize: function(callback) {
        if (callback) callback(null);
      }
    };
  }
};

// ── Database Initialization ───────────────────────────────────────────
(async function initDb() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS Users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('TEACHER', 'STUDENT')) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS QuestionBanks (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacher_id) REFERENCES Users(id)
      )
    `);

    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS Exams (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        title TEXT NOT NULL,
        bank_id TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        pool_size INTEGER NOT NULL,
        required_attempts_count INTEGER NOT NULL,
        shuffle_questions INTEGER DEFAULT 1,
        shuffle_options INTEGER DEFAULT 1,
        proctoring_level TEXT CHECK(proctoring_level IN ('OFF', 'LOW', 'STRICT')) DEFAULT 'STRICT',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacher_id) REFERENCES Users(id),
        FOREIGN KEY(bank_id) REFERENCES QuestionBanks(id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ExamAttempts (
        id TEXT PRIMARY KEY,
        exam_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        status TEXT CHECK(status IN ('IN_PROGRESS', 'SUBMITTED', 'TERMINATED')) DEFAULT 'IN_PROGRESS',
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        total_score REAL DEFAULT 0.0,
        FOREIGN KEY(exam_id) REFERENCES Exams(id),
        FOREIGN KEY(student_id) REFERENCES Users(id),
        UNIQUE(exam_id, student_id)
      )
    `);

    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS StudentAnswers (
        attempt_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        student_response TEXT,
        is_marked_for_review INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(attempt_id, question_id),
        FOREIGN KEY(attempt_id) REFERENCES ExamAttempts(id) ON DELETE CASCADE,
        FOREIGN KEY(question_id) REFERENCES Questions(id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ProctorLogs (
        id SERIAL PRIMARY KEY,
        student_id TEXT NOT NULL,
        violation_type TEXT NOT NULL,
        details TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES Users(id)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON Users(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_student_roll ON StudentProfiles(roll_number);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_questions_bank ON Questions(bank_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assigned_attempt ON AssignedQuestions(attempt_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_answers_attempt ON StudentAnswers(attempt_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_proctor_student ON ProctorLogs(student_id);`);

    // ── Subjects table ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS Subjects (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT DEFAULT '#4f46e5',
        icon TEXT DEFAULT '📚',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacher_id) REFERENCES Users(id) ON DELETE CASCADE,
        UNIQUE(teacher_id, name)
      )
    `);

    // ── Exam ↔ multiple question banks ────────────────────────────
    await client.query(`
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS Announcements (
        id SERIAL PRIMARY KEY,
        exam_id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        target_student_id TEXT,
        message TEXT NOT NULL,
        type TEXT CHECK(type IN ('BROADCAST','INDIVIDUAL')) DEFAULT 'BROADCAST',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(exam_id) REFERENCES Exams(id) ON DELETE CASCADE
      )
    `);

    // ── Teacher profiles ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS TeacherProfiles (
        teacher_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Teacher',
        profile_photo TEXT,
        department TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacher_id) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    // ── Safe non-destructive column migrations ────────────────────
    await client.query(`ALTER TABLE Exams ADD COLUMN IF NOT EXISTS selected_question_ids TEXT`);
    await client.query(`ALTER TABLE Exams ADD COLUMN IF NOT EXISTS code TEXT`);
    await client.query(`ALTER TABLE Exams ADD COLUMN IF NOT EXISTS total_marks REAL DEFAULT 100`);
    await client.query(`ALTER TABLE Exams ADD COLUMN IF NOT EXISTS pass_marks REAL DEFAULT 40`);
    await client.query(`ALTER TABLE Exams ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1`);
    await client.query(`ALTER TABLE Exams ADD COLUMN IF NOT EXISTS subject_id TEXT`);
    await client.query(`ALTER TABLE Questions ADD COLUMN IF NOT EXISTS image_url TEXT`);
    await client.query(`ALTER TABLE StudentProfiles ADD COLUMN IF NOT EXISTS profile_photo TEXT`);
    await client.query(`ALTER TABLE Users ADD COLUMN IF NOT EXISTS reset_token TEXT`);
    await client.query(`ALTER TABLE Users ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMP`);
    await client.query(`ALTER TABLE Users ADD COLUMN IF NOT EXISTS otp_code TEXT`);
    await client.query(`ALTER TABLE Users ADD COLUMN IF NOT EXISTS otp_expiry TIMESTAMP`);
    await client.query(`ALTER TABLE QuestionBanks ADD COLUMN IF NOT EXISTS subject_id TEXT`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_subjects_teacher ON Subjects(teacher_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_exambanks_exam ON ExamBanks(exam_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_announcements_exam ON Announcements(exam_id);`);

    await client.query('COMMIT');
    console.log('Database initialization completed successfully.');
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rbErr) { /* ignore */ }
    }
    console.error('Database initialization failed:', err);
  } finally {
    if (client) client.release();
  }
})();

module.exports = db;
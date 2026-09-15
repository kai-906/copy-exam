const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID: uuidv4 } = require('crypto');
const { JWT_SECRET } = require('../middleware/auth');
const { sendOTPEmail } = require('../utils/mailer');

exports.registerTeacher = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    db.run(
      `INSERT INTO Users (id, email, password_hash, role) VALUES (?, ?, ?, 'TEACHER')`,
      [userId, email, hashedPassword],
      function (err) {
        if (err) return res.status(400).json({ error: 'Email already registered.' });
        res.status(201).json({ message: 'Teacher registered successfully', userId });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error during password hashing.' });
  }
};

exports.loginTeacher = (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM Users WHERE email = ? AND role = 'TEACHER'`, [email], async (err, user) => {
    if (err || !user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  });
};

exports.registerStudent = async (req, res) => {
  const { email, password, name, branch, year } = req.body;
  const roll_number = req.body.roll_number || req.body.rollNo;
  const photo = req.body.photo || req.body.profile_photo || null;

  if (!email || !password || !roll_number || !name) {
    return res.status(400).json({ error: 'Name, email, password and roll number are required.' });
  }

  if (!photo) {
    return res.status(400).json({ error: 'Live verification photo is required for registration.' });
  }

  // 1. Single Account Policy: Check duplicate Email or Roll Number
  const checkQuery = `
    SELECT Users.id FROM Users 
    LEFT JOIN StudentProfiles ON Users.id = StudentProfiles.student_id 
    WHERE Users.email = ? OR StudentProfiles.roll_number = ?
  `;

  db.get(checkQuery, [email, roll_number], async (err, existingUser) => {
    if (err) return res.status(500).json({ error: 'Database check failed.' });

    if (existingUser) {
      return res.status(409).json({ error: 'Account with this Email or Roll Number already exists.' });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const userId = uuidv4();

      // 2. Insert into Users table
      db.run(
        `INSERT INTO Users (id, email, password_hash, role) VALUES (?, ?, ?, 'STUDENT')`,
        [userId, email, hashedPassword],
        function (userErr) {
          if (userErr) {
            return res.status(400).json({ error: 'Failed to create account or email already exists.' });
          }

          // 3. Insert into StudentProfiles table including Profile Photo
          const profileQuery = `
            INSERT INTO StudentProfiles (student_id, name, roll_number, branch, year, profile_photo) 
            VALUES (?, ?, ?, ?, ?, ?)
          `;

          db.run(
            profileQuery,
            [userId, name, roll_number, branch, year, photo || null],
            function (profileErr) {
              if (profileErr) {
                // Rollback user if profile insertion fails
                db.run(`DELETE FROM Users WHERE id = ?`, [userId]);
                return res.status(400).json({ error: 'Failed to save student profile details.' });
              }

              res.status(201).json({ 
                message: 'Student registered successfully', 
                studentId: userId 
              });
            }
          );
        }
      );
    } catch (error) {
      res.status(500).json({ error: 'Server error during hashing.' });
    }
  });
};

exports.loginStudent = (req, res) => {
  const roll_number = req.body.roll_number || req.body.rollNo;
  const password = req.body.password;
  const query = `
    SELECT Users.*, StudentProfiles.name, StudentProfiles.roll_number, StudentProfiles.profile_photo 
    FROM Users JOIN StudentProfiles ON Users.id = StudentProfiles.student_id 
    WHERE StudentProfiles.roll_number = ?
  `;
  
  db.get(query, [roll_number], async (err, user) => {
    if (err || !user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid Roll Number or password.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, roll_number: user.roll_number }, 
      JWT_SECRET, 
      { expiresIn: '6h' }
    );

    res.json({ 
      token, 
      student: { 
        id: user.id, 
        name: user.name, 
        rollNumber: user.roll_number,
        photo: user.profile_photo 
      } 
    });
  });
};

/* ══════════════════════════════════════════════════════
   FORGOT PASSWORD — sends 6-digit OTP to registered email
══════════════════════════════════════════════════════ */
exports.forgotPassword = (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  // Look up user + name (students have StudentProfiles, teachers don't)
  db.get(
    `SELECT u.id, u.email,
            COALESCE(sp.name, tp.name, 'User') AS name
     FROM Users u
     LEFT JOIN StudentProfiles sp ON sp.student_id = u.id
     LEFT JOIN TeacherProfiles tp ON tp.teacher_id = u.id
     WHERE u.email = ?`,
    [email],
    async (err, user) => {
      if (err) return res.status(500).json({ error: 'Database error.' });

      // Always respond the same way — don't reveal if email exists
      if (!user) {
        return res.json({ message: 'If an account with that email exists, an OTP has been sent.' });
      }

      // Generate 6-digit OTP
      const otp    = String(Math.floor(100000 + Math.random() * 900000));
      const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

      db.run(
        `UPDATE Users SET otp_code = ?, otp_expiry = ? WHERE id = ?`,
        [otp, expiry, user.id],
        async (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Failed to generate OTP.' });

          // Send email (async — don't block response on failure)
          try {
            await sendOTPEmail(email, otp, user.name);
            console.log(`[Auth] OTP sent to ${email}`);
          } catch (mailErr) {
            console.error('[Auth] Email send failed:', mailErr.message);
            // Still respond OK — OTP saved in DB; teacher can check server console
          }

          res.json({
            message: 'If an account with that email exists, an OTP has been sent.',
            // In development, also return OTP so it can be used without email
            ...(process.env.NODE_ENV !== 'production' && { _devOtp: otp })
          });
        }
      );
    }
  );
};

/* ══════════════════════════════════════════════════════
   VERIFY OTP — checks the 6-digit code, returns a
   one-time reset token if correct
══════════════════════════════════════════════════════ */
exports.verifyOTP = (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

  db.get(
    `SELECT id, otp_code, otp_expiry FROM Users WHERE email = ?`,
    [email],
    (err, user) => {
      if (err)   return res.status(500).json({ error: 'Database error.' });
      if (!user) return res.status(400).json({ error: 'Invalid OTP or email.' });

      // Check expiry
      if (!user.otp_code || new Date(user.otp_expiry) < new Date()) {
        return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
      }

      // Check match (string compare)
      if (String(user.otp_code).trim() !== String(otp).trim()) {
        return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
      }

      // OTP correct — generate a short-lived reset token and clear OTP
      const resetToken = uuidv4();
      const expiry     = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

      db.run(
        `UPDATE Users SET otp_code = NULL, otp_expiry = NULL,
                          reset_token = ?, reset_token_expiry = ?
         WHERE id = ?`,
        [resetToken, expiry, user.id],
        (updErr) => {
          if (updErr) return res.status(500).json({ error: 'Failed to issue reset token.' });
          res.json({ message: 'OTP verified.', resetToken });
        }
      );
    }
  );
};

/* ══════════════════════════════════════════════════════
   RESET PASSWORD — uses the token issued after OTP verify
══════════════════════════════════════════════════════ */
exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });

  db.get(
    `SELECT id FROM Users WHERE reset_token = ? AND reset_token_expiry > CURRENT_TIMESTAMP`,
    [token],
    async (err, user) => {
      if (err)   return res.status(500).json({ error: 'Database error.' });
      if (!user) return res.status(400).json({ error: 'Invalid or expired reset token.' });

      try {
        const hash = await bcrypt.hash(newPassword, 10);
        db.run(
          `UPDATE Users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?`,
          [hash, user.id],
          (updErr) => {
            if (updErr) return res.status(500).json({ error: 'Failed to reset password.' });
            res.json({ message: 'Password has been reset successfully. You can now log in.' });
          }
        );
      } catch (hashErr) {
        res.status(500).json({ error: 'Server error during password hashing.' });
      }
    }
  );
};
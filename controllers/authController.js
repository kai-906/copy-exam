const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { JWT_SECRET } = require('../middleware/auth');

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

exports.forgotPassword = (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  db.get(`SELECT id FROM Users WHERE email = ?`, [email], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!user) {
      // Simulate successful request for security
      return res.json({ message: 'If an account exists with this email, a reset link has been generated.' });
    }

    const resetToken = uuidv4();
    const expiry = new Date(Date.now() + 1000 * 60 * 15).toISOString(); // 15 mins

    db.run(
      `UPDATE Users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?`,
      [resetToken, expiry, user.id],
      function (updateErr) {
        if (updateErr) return res.status(500).json({ error: 'Failed to generate reset token.' });
        
        console.log(`\n==================================================`);
        console.log(`🔑 PASSWORD RESET LINK GENERATED (SIMULATED EMAIL)`);
        console.log(`To: ${email}`);
        console.log(`Reset Token: ${resetToken}`);
        console.log(`==================================================\n`);

        res.json({ message: 'If an account exists with this email, a reset link has been generated.', debugToken: resetToken });
      }
    );
  });
};

exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });

  db.get(`SELECT id FROM Users WHERE reset_token = ? AND reset_token_expiry > CURRENT_TIMESTAMP`, [token], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token.' });

    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      db.run(
        `UPDATE Users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?`,
        [hashedPassword, user.id],
        function (updateErr) {
          if (updateErr) return res.status(500).json({ error: 'Failed to reset password.' });
          res.json({ message: 'Password has been successfully reset.' });
        }
      );
    } catch (hashError) {
      res.status(500).json({ error: 'Server error during password hashing.' });
    }
  });
};
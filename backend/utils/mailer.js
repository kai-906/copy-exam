/**
 * mailer.js — Nodemailer transporter utility
 * Uses Gmail SMTP with App Password (configured in .env).
 * Falls back to Ethereal (fake SMTP) for local dev if credentials not set.
 */

'use strict';

const nodemailer = require('nodemailer');

let _transporter = null;
let _testAccount  = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  // Real credentials configured → use Gmail SMTP
  if (user && pass &&
      user !== 'your_email@gmail.com' &&
      pass !== 'your_app_password_here' &&
      pass !== 'your_16_char_app_password') {

    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });

    console.log('[Mailer] Using Gmail SMTP:', user);
    return _transporter;
  }

  // Dev mode — use Ethereal fake SMTP (catches emails, shows in console)
  if (!_testAccount) {
    _testAccount = await nodemailer.createTestAccount();
    console.log('\n[Mailer] ⚠️  EMAIL_USER/PASS not set — using Ethereal test account.');
    console.log('[Mailer] Preview URL will be printed for each email sent.\n');
  }

  _transporter = nodemailer.createTransport({
    host:   'smtp.ethereal.email',
    port:   587,
    secure: false,
    auth: {
      user: _testAccount.user,
      pass: _testAccount.pass
    }
  });

  return _transporter;
}

/**
 * sendOTPEmail(to, otp, name)
 * Sends a 6-digit OTP to the given email address.
 */
async function sendOTPEmail(to, otp, name = 'Student') {
  const transporter = await getTransporter();
  const from        = process.env.EMAIL_FROM || `SmartExam <${process.env.EMAIL_USER || 'noreply@smartexam.app'}>`;

  const info = await transporter.sendMail({
    from,
    to,
    subject: `${otp} — Your SmartExam Password Reset OTP`,
    text: `
Hi ${name},

Your OTP for resetting your SmartExam password is:

  ${otp}

This OTP is valid for 10 minutes. Do not share it with anyone.

If you did not request a password reset, please ignore this email.

— SmartExam Team
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
        style="background:#1e293b;border:1px solid rgba(99,102,241,0.2);border-radius:16px;overflow:hidden;max-width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">
              🎓 SmartExam
            </h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">
              Password Reset OTP
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;line-height:1.6;">
              Hi <strong style="color:#e2e8f0;">${name}</strong>,
            </p>
            <p style="margin:0 0 24px;color:#94a3b8;font-size:13px;line-height:1.7;">
              We received a request to reset your password. Use the OTP below to proceed:
            </p>

            <!-- OTP Box -->
            <div style="background:#0f172a;border:2px solid #6366f1;border-radius:12px;
                        padding:22px;text-align:center;margin-bottom:24px;">
              <div style="font-size:42px;font-weight:900;letter-spacing:0.18em;
                          color:#818cf8;font-family:'Courier New',monospace;">
                ${otp}
              </div>
              <p style="margin:8px 0 0;font-size:11px;color:#475569;">
                Valid for <strong style="color:#f59e0b;">10 minutes</strong>
              </p>
            </div>

            <p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.6;">
              ⚠️ Do not share this OTP with anyone. SmartExam staff will never ask for it.
            </p>
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
              If you did not request a password reset, you can safely ignore this email.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="border-top:1px solid rgba(255,255,255,0.07);padding:16px 32px;text-align:center;">
            <p style="margin:0;color:#475569;font-size:11px;">
              © SmartExam — Secure Online Examination System
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `
  });

  // In dev/Ethereal mode print the preview URL
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log('\n[Mailer] 📧 OTP Email Preview (Ethereal):');
    console.log('   ' + previewUrl);
    console.log('[Mailer] OTP:', otp, '→', to, '\n');
  }

  return info;
}

module.exports = { sendOTPEmail };

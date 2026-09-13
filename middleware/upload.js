const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// Auto-create uploads directory
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});

// PDF only — Gemini handles the heavy lifting including images
const fileFilter = (req, file, cb) => {
  const ext  = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;
  if (ext === '.pdf' || mime === 'application/pdf' || mime === 'application/octet-stream') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files (.pdf) are supported.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }  // 50 MB — needed for image-heavy PDFs
});

module.exports = upload;

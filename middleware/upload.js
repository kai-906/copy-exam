const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Project Root Directory me uploads folder auto-create
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Unique Filename to prevent overwrite collisions
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});

// Only allow PDF files by MIME type and extension
const pdfFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;
  if (ext === '.pdf' && (mime === 'application/pdf' || mime === 'application/octet-stream')) {
    cb(null, true);
  } else if (ext === '.pdf') {
    // Some systems report PDFs as octet-stream; accept by extension as fallback
    cb(null, true);
  } else {
    cb(new Error('Only PDF files (.pdf) are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: pdfFileFilter,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB File Limit
});

module.exports = upload;
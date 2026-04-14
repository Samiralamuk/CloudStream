const multer = require("multer");

// ── Allowed file types ────────────────────────────────────────────
// Exactly the whitelist described in CW1 Slide 8:
// JPEG, PNG, MP4, MP3, PDF only
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "video/mp4",
  "audio/mpeg",
  "application/pdf",
];

// ── Storage: memoryStorage ────────────────────────────────────────
// Files are held in RAM as a Buffer (req.file.buffer)
// They are never written to disk on the server
// This is the correct approach for cloud apps — the file goes
// straight from RAM into Blob Storage without touching the filesystem
const storage = multer.memoryStorage();

// ── File filter ───────────────────────────────────────────────────
// Called for every incoming file before it is accepted
// cb(null, true)  = accept the file
// cb(error, false) = reject the file with an error
const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `File type not allowed. Accepted types: JPEG, PNG, MP4, MP3, PDF`
      ),
      false
    );
  }
};

// ── Multer instance ───────────────────────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB — exactly as stated in Slide 8
  },
});

module.exports = upload;
// ── Load environment variables first ─────────────────────────────
// Must be the very first line — everything below may depend on process.env
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");

const app = express();

// ── Core middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session middleware ────────────────────────────────────────────
// Must be set up BEFORE route imports
// secret:            signs the session cookie — read from .env
// resave:            false = don't save session if nothing changed
// saveUninitialized: false = don't create session until something stored
//                    (important for GDPR compliance — Slide 13)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // JS cannot read the cookie — prevents XSS theft
      maxAge: 1000 * 60 * 60 * 24, // 24 hours in milliseconds
    },
  }),
);

// ── Static files ──────────────────────────────────────────────────
// Serves everything in /public directly
// index.html → http://localhost:3000/
// gallery.html → http://localhost:3000/gallery.html
// style.css → http://localhost:3000/style.css
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ────────────────────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/media", require("./routes/media"));

// ── Health check ──────────────────────────────────────────────────
// Useful for verifying the server is running
// Also used later by Azure App Service health monitoring
app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    app: "CloudStream",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

// ── Global error handler ──────────────────────────────────────────
// Catches any error passed via next(err) from routes
// Multer errors (file too large, wrong type) arrive here
app.use((err, req, res, next) => {
  console.error("Global error:", err.message);

  // Multer-specific errors have a code property
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(400)
      .json({ error: "File too large. Maximum size is 50MB." });
  }
  if (err.message && err.message.includes("File type not allowed")) {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: "Something went wrong on the server." });
});

// ── Start server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`-----------------------------------------`);
  console.log(`🚀 CloudStream running at http://localhost:${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`-----------------------------------------`);
});
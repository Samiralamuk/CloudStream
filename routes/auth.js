const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");

// ── POST /api/auth/register ───────────────────────────────────────
// Creates a new user account
// 1. Validates input exists
// 2. Hashes the password with bcrypt (cost factor 10)
// 3. Inserts into users table
// 4. Returns 201 Created
router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  // Basic validation
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  }

  try {
    // bcrypt hash — cost factor 10 means 2^10 = 1024 iterations
    // Slow enough to resist brute force, fast enough for normal use
    const hash = await bcrypt.hash(password, 10);

    const stmt = db.prepare(
      "INSERT INTO users (user_id, email, password_hash) VALUES (?, ?, ?)"
    );
    stmt.run(uuidv4(), email, hash);

    res.status(201).json({ message: "Account created successfully" });
  } catch (err) {
    // SQLite throws this specific message when UNIQUE constraint fails
    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error("Register error:", err.message);
    res.status(500).json({ error: "Server error during registration" });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────
// Authenticates a user
// 1. Finds user by email
// 2. Compares submitted password against stored hash
// 3. Stores userId in session on success
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);

    // Use same error message for both "not found" and "wrong password"
    // Never tell attackers which one it was
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Store in session — this is what requireAuth checks in media.js
    req.session.userId = user.user_id;
    req.session.email = user.email;

    res.json({
      message: "Logged in successfully",
      email: user.email,
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────
// Destroys the session completely
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not log out" });
    }
    res.json({ message: "Logged out successfully" });
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────
// Returns current logged-in user info
// Frontend uses this on page load to check if session is still active
router.get("/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  res.json({
    userId: req.session.userId,
    email: req.session.email,
  });
});

module.exports = router;
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const sql = require('mssql');

// ── Azure SQL connection pool config ──────────────────────────────────────────
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

// Pool is created once and reused across all requests
let pool;
async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const db = await getPool();

    // Check if email already exists
    const existing = await db.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT user_id FROM users WHERE email = @email');

    if (existing.recordset.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password and insert new user
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    await db.request()
      .input('user_id', sql.NVarChar, userId)
      .input('email', sql.NVarChar, email)
      .input('password_hash', sql.NVarChar, passwordHash)
      .query('INSERT INTO users (user_id, email, password_hash) VALUES (@user_id, @email, @password_hash)');

    res.status(201).json({ message: 'Registered successfully' });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const db = await getPool();

    const result = await db.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT user_id, email, password_hash FROM users WHERE email = @email');

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.recordset[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Store user info in session
    req.session.userId = user.user_id;
    req.session.email = user.email;

    res.json({ message: 'Logged in successfully', email: user.email });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
// Called by the frontend to check if a session exists
router.get('/me', (req, res) => {
  if (req.session.userId) {
    res.json({ loggedIn: true, email: req.session.email });
  } else {
    res.json({ loggedIn: false });
  }
});

module.exports = router;
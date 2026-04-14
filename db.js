const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.SQLITE_PATH || './cloudstream.db');

// ── Users table ───────────────────────────────────────────────────
// Mirrors your Azure SQL schema from CW1 Slide 6
// Fields: user_id, email, password_hash
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id       TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now'))
  );
`);

// ── Media table ───────────────────────────────────────────────────
// Mirrors your Cosmos DB document model from CW1 Slide 6
// Fields: id, userId (partition key), title, description,
//         mediaType, blobUrl, sizeMb, uploadDate
db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id          TEXT PRIMARY KEY,
    userId      TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    mediaType   TEXT,
    blobUrl     TEXT,
    sizeMb      TEXT,
    uploadDate  TEXT
  );
`);

console.log('Database ready — cloudstream.db');

module.exports = db;
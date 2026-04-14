const express = require("express");
const router = express.Router();
const { BlobServiceClient } = require("@azure/storage-blob");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const upload = require("../middleware/upload");
const db = require("../db");

// ── Blob Storage client ───────────────────────────────────────────
// Reads connection string from .env
// Locally: points to Azurite (http://127.0.0.1:10000)
// On Azure: points to real Blob Storage (just .env changes, not this code)
function getContainerClient() {
  const blobService = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING
  );
  return blobService.getContainerClient(process.env.AZURE_CONTAINER_NAME);
}

// ── Auth guard ────────────────────────────────────────────────────
// Added to every route below
// Checks session has a userId — if not, returns 401 immediately
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Please log in to continue" });
  }
  next(); // session valid — proceed to route handler
}

// ── POST /api/media ───────────────────────────────────────────────
// Implements: CW1 Slide 7 — POST /upload sequence diagram
// Flow: receive file → validate (Multer) → upload to Blob → save metadata → notify Logic App
router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const containerClient = getContainerClient();

    // Create container if it doesn't exist yet
    // On Azurite this runs on first upload — safe to call every time
    await containerClient.createIfNotExists({ access: "blob" });

    // Generate a unique blob name — prevents filename collisions
    const blobName = `${uuidv4()}-${req.file.originalname}`;
    const blockBlob = containerClient.getBlockBlobClient(blobName);

    // Upload file buffer to Blob Storage (Azurite locally)
    // Sets the correct Content-Type so browsers can display the file
    await blockBlob.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype },
    });

    // Build the media document — mirrors Cosmos DB schema from Slide 6
    const doc = {
      id: uuidv4(),
      userId: req.session.userId,
      title: req.body.title || req.file.originalname,
      description: req.body.description || "",
      mediaType: req.file.mimetype,
      blobUrl: blockBlob.url,
      sizeMb: (req.file.size / 1048576).toFixed(2),
      uploadDate: new Date().toISOString(),
    };

    // Save metadata to SQLite (swapped for Cosmos DB in Phase 2)
    db.prepare(`
      INSERT INTO media
        (id, userId, title, description, mediaType, blobUrl, sizeMb, uploadDate)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.id,
      doc.userId,
      doc.title,
      doc.description,
      doc.mediaType,
      doc.blobUrl,
      doc.sizeMb,
      doc.uploadDate
    );

    // Notify Logic App — Slide 4 data flow ③
    // Skipped silently if LOGIC_APP_WEBHOOK_URL is blank (local dev)
    if (process.env.LOGIC_APP_WEBHOOK_URL) {
      axios
        .post(process.env.LOGIC_APP_WEBHOOK_URL, {
          title: doc.title,
          userId: doc.userId,
        })
        .catch((err) => console.warn("Logic App notify failed:", err.message));
    }

    res.status(201).json(doc);
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/media ────────────────────────────────────────────────
// Implements: CW1 Slide 7 — GET /api/media sequence diagram
// Returns all media items belonging to the logged-in user
// Ordered newest first
router.get("/", requireAuth, (req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT * FROM media WHERE userId = ? ORDER BY uploadDate DESC"
      )
      .all(req.session.userId);

    res.json(rows);
  } catch (err) {
    console.error("Fetch error:", err.message);
    res.status(500).json({ error: "Could not fetch media" });
  }
});

// ── PUT /api/media/:id ────────────────────────────────────────────
// Implements: CW1 Slide 7 — PUT /api/media/:id sequence diagram
// Updates title and description of an existing media item
// userId check ensures users can only edit their own items
router.put("/:id", requireAuth, (req, res) => {
  const { title, description } = req.body;

  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  try {
    const result = db
      .prepare(`
        UPDATE media
        SET title = ?, description = ?
        WHERE id = ? AND userId = ?
      `)
      .run(title, description || "", req.params.id, req.session.userId);

    // changes === 0 means either item not found or belongs to another user
    if (result.changes === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    // Return the updated document
    const updated = db
      .prepare("SELECT * FROM media WHERE id = ?")
      .get(req.params.id);

    res.json(updated);
  } catch (err) {
    console.error("Update error:", err.message);
    res.status(500).json({ error: "Could not update item" });
  }
});

// ── DELETE /api/media/:id ─────────────────────────────────────────
// Implements: CW1 Slide 7 — DELETE /api/media/:id sequence diagram
// Flow: find item → delete blob from storage → delete metadata from DB
// Both must succeed — if blob delete fails, metadata is kept (data integrity)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    // Find the item first — need the blobUrl to delete from storage
    const item = db
      .prepare("SELECT * FROM media WHERE id = ? AND userId = ?")
      .get(req.params.id, req.session.userId);

    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }

    // Extract blob name from the full URL
    // URL looks like: http://127.0.0.1:10000/devstoreaccount1/media-container/uuid-filename.jpg
    // We need just: uuid-filename.jpg
    const blobName = item.blobUrl.split("/").pop();

    // Delete from Blob Storage first
    const containerClient = getContainerClient();
    await containerClient.getBlockBlobClient(blobName).deleteIfExists();

    // Then delete metadata from SQLite
    db.prepare("DELETE FROM media WHERE id = ?").run(req.params.id);

    // 204 No Content — success with no response body
    res.status(204).send();
  } catch (err) {
    console.error("Delete error:", err.message);
    res.status(500).json({ error: "Could not delete item" });
  }
});

module.exports = router;
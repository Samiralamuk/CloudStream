const express = require('express');
const router = express.Router();
const { BlobServiceClient } = require('@azure/storage-blob');
const { CosmosClient } = require('@azure/cosmos');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const upload = require('../middleware/upload');

// ── Azure Blob Storage client ─────────────────────────────────────────────────
const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobServiceClient.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER_NAME
);

// ── Azure Cosmos DB client ────────────────────────────────────────────────────
const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});
const cosmosContainer = cosmosClient
  .database(process.env.COSMOS_DATABASE)
  .container(process.env.COSMOS_CONTAINER);

// ── Auth guard middleware ─────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ── POST /api/media/upload ────────────────────────────────────────────────────
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { title, description } = req.body;
  const userId = req.session.userId;
  const userEmail = req.session.email;
  const mediaId = uuidv4();

  // Build a unique blob name using the mediaId to avoid collisions
  const blobName = `${userId}/${mediaId}-${req.file.originalname}`;

  try {
    // ── 1. Upload file buffer to Azure Blob Storage ───────────────
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype }
    });
    const blobUrl = blockBlobClient.url;

    // ── 2. Save metadata document to Cosmos DB ────────────────────
    const mediaDocument = {
      id: mediaId,
      userId: userId,
      title: title || req.file.originalname,
      description: description || '',
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      blobName: blobName,
      blobUrl: blobUrl,
      sizeMb: (req.file.size / (1024 * 1024)).toFixed(2),
      uploadDate: new Date().toISOString()
    };

    await cosmosContainer.items.create(mediaDocument);

    // ── 3. Notify Logic App (fire and forget — don't fail upload if this errors) ──
    try {
      await axios.post(process.env.LOGIC_APP_URL, {
        filename: req.file.originalname,
        uploadedBy: userEmail,
        title: title || req.file.originalname,
        message: `New file uploaded to CloudStream by ${userEmail}`
      });
    } catch (logicErr) {
      // Log but do not fail the request — notification is non-critical
      console.warn('Logic App notification failed:', logicErr.message);
    }

    res.status(201).json({
      message: 'Upload successful',
      media: mediaDocument
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ── GET /api/media ────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  try {
    // Query only the documents belonging to this user using the partition key
    const { resources } = await cosmosContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.uploadDate DESC',
        parameters: [{ name: '@userId', value: userId }]
      })
      .fetchAll();

    res.json(resources);

  } catch (err) {
    console.error('Fetch media error:', err);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// ── PUT /api/media/:id ────────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;
  const { title, description } = req.body;

  try {
    // Read the existing document first — needed to do a full replace
    const { resource: existing } = await cosmosContainer
      .item(id, userId)
      .read();

    if (!existing) {
      return res.status(404).json({ error: 'Media item not found' });
    }

    // Merge the updated fields into the existing document
    const updated = {
      ...existing,
      title: title !== undefined ? title : existing.title,
      description: description !== undefined ? description : existing.description
    };

    const { resource: replaced } = await cosmosContainer
      .item(id, userId)
      .replace(updated);

    res.json(replaced);

  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ── DELETE /api/media/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;

  try {
    // Read the document first to get the blobName for Blob Storage deletion
    const { resource: existing } = await cosmosContainer
      .item(id, userId)
      .read();

    if (!existing) {
      return res.status(404).json({ error: 'Media item not found' });
    }

    // ── 1. Delete blob from Azure Blob Storage ────────────────────
    const blockBlobClient = containerClient.getBlockBlobClient(existing.blobName);
    await blockBlobClient.delete();

    // ── 2. Delete metadata document from Cosmos DB ────────────────
    await cosmosContainer.item(id, userId).delete();

    res.status(204).send();

  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
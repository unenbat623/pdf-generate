import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFile } from './lib/parse.js';
import { translateHtml, activeProvider } from './lib/translate.js';
import { htmlToDocx } from './lib/export.js';
import { closeBrowser, htmlToPdf } from './lib/pdf.js';
import { reconstructHtml, reconstructProvider } from './lib/reconstruct.js';
import { sanitizeHtml } from './lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const ALLOWED_IMPORT_EXTS = new Set(['docx', 'xlsx', 'xls', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp']);
const ALLOWED_LANGS = new Set(['src', 'ja', 'en']);

app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function cleanError(error) {
  return process.env.NODE_ENV === 'production' ? 'Сервер дээр алдаа гарлаа.' : error.message;
}

function originalExtension(filename = '') {
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  return ext;
}

function downloadName(prefix, lang, ext) {
  const safeLang = ALLOWED_LANGS.has(lang) ? lang : 'src';
  return `${prefix}-${safeLang}.${ext}`;
}

// Идэвхтэй орчуулгын провайдер
app.get('/api/config', (_req, res) => {
  res.json({ provider: activeProvider(), version: 'ai-reconstruct-7', aiDesign: reconstructProvider() || null });
});

// AI-аар дизайн сэргээх (текст -> дизайнтай HTML)
app.post('/api/reconstruct', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text алга.' });
    const html = await reconstructHtml(text);
    res.json({ html });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: cleanError(e) });
  }
});

// Файл оруулах -> HTML
app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл алга.' });
    const ext = originalExtension(req.file.originalname);
    if (!ALLOWED_IMPORT_EXTS.has(ext)) {
      return res.status(400).json({ error: 'Дэмжигдэхгүй файлын төрөл.' });
    }
    const { html, warnings } = await parseFile(req.file);
    res.json({ html, warnings, name: req.file.originalname });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: cleanError(e) });
  }
});

// Орчуулга
app.post('/api/translate', async (req, res) => {
  try {
    const { html, target } = req.body || {};
    if (!html) return res.status(400).json({ error: 'html алга.' });
    const translated = await translateHtml(sanitizeHtml(html), target);
    res.json({ html: sanitizeHtml(translated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: cleanError(e) });
  }
});

// Word татах
app.post('/api/export/docx', async (req, res) => {
  try {
    const { html, title, lang } = req.body || {};
    if (!html) return res.status(400).json({ error: 'html алга.' });
    const buffer = await htmlToDocx(html, title || 'Баримт');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName('document', lang, 'docx')}"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: cleanError(e) });
  }
});

// PDF татах (Chromium / WYSIWYG — дизайн яг байгаагаар)
app.post('/api/export/pdf', async (req, res) => {
  try {
    const { html, lang } = req.body || {};
    if (!html) return res.status(400).json({ error: 'html алга.' });
    const buffer = await htmlToPdf(html, { lang: lang || 'src' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName('document', lang, 'pdf')}"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'PDF үүсгэхэд алдаа гарлаа: ' + cleanError(e) });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n  Баримт-орчуулга веб → http://localhost:${PORT}`);
  console.log(`  Орчуулгын провайдер: ${activeProvider()}\n`);
});

async function shutdown(signal) {
  console.log(`\n  ${signal} авлаа. Серверийг хааж байна...`);
  server.close(async () => {
    await closeBrowser().catch(() => {});
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

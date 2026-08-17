import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFile, SUPPORTED_EXTENSIONS } from './lib/parse.js';
import { translateHtml, activeProvider } from './lib/translate.js';
import { htmlToDocx } from './lib/export.js';
import { closeBrowser, htmlToPdf, htmlToImages } from './lib/pdf.js';
import { reconstructHtml, reconstructProvider } from './lib/reconstruct.js';
import { sanitizeHtml } from './lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
const ALLOWED_LANGS = new Set(['src', 'ja', 'en']);

app.use(express.json({ limit: '120mb' }));
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
  res.json({
    provider: activeProvider(),
    version: 'universal-import-1',
    aiDesign: reconstructProvider() || null,
    formats: SUPPORTED_EXTENSIONS,
  });
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
    // Төрлийг өргөтгөлөөр хатуу шүүхгүй — parseFile нь агуулгаас нь таньж,
    // танигдаагүй тохиолдолд текст болгон уншина (ямар ч файлыг оруулж болно).
    const started = Date.now();
    const { html, warnings } = await parseFile(req.file);
    console.log(`import: ${req.file.originalname} (${originalExtension(req.file.originalname)}) → ${html.length} тэмдэгт, ${Date.now() - started}ms`);
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

// Зураг татах (PNG — 1 хуудас бол шууд зураг, олон хуудас бол ZIP)
app.post('/api/export/image', async (req, res) => {
  try {
    const { html, lang } = req.body || {};
    if (!html) return res.status(400).json({ error: 'html алга.' });
    const images = await htmlToImages(html, { lang: lang || 'src' });
    if (images.length === 1) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName('document', lang, 'png')}"`);
      return res.send(images[0]);
    }
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    images.forEach((img, i) => zip.file(`page-${String(i + 1).padStart(2, '0')}.png`, img));
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName('document-images', lang, 'zip')}"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Зураг үүсгэхэд алдаа гарлаа: ' + cleanError(e) });
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

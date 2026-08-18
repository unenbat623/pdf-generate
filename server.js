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
import { cleanApiKey } from './lib/ocr.js';
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

// Сүүлийн алдаануудыг санах ойд хадгална — Railway-ийн log руу орохгүйгээр
// GET /api/debug/errors гэж нээгээд оношлох боломж олгоно.
const lastErrors = [];
function recordError(route, e, extra = {}) {
  lastErrors.unshift({
    time: new Date().toISOString(),
    route,
    message: e?.message || String(e),
    stack: (e?.stack || '').split('\n').slice(0, 4).join(' | '),
    ...extra,
  });
  if (lastErrors.length > 20) lastErrors.pop();
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
    version: 'ocr-image-3',
    aiDesign: reconstructProvider() || null,
    // Оношилгоо: түлхүүрийн эхний 6 тэмдэгт + урт (түлхүүр өөрөө задрахгүй)
    aiKeyHint: (() => {
      try {
        const k = cleanApiKey(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY, 'key');
        return k ? `${k.slice(0, 6)}…(${k.length})` : null;
      } catch (e) {
        return 'алдаа: ' + e.message;
      }
    })(),
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
    recordError('export/pdf', e, { htmlLength: req.body?.html?.length ?? null, pdfStats: e.pdfStats || null });
    // Унагасан HTML-ийг оношилгоонд зориулж хадгална (GET /api/debug/last-html)
    if (req.body?.html) {
      import('node:fs/promises')
        .then((fs) => fs.writeFile('/tmp/last-failed.html', req.body.html))
        .catch(() => {});
    }
    // PDF-ийн алдааг нуувал оношлох боломжгүй тул жинхэнэ мессежийг буцаана
    res.status(500).json({ error: 'PDF үүсгэхэд алдаа гарлаа: ' + (e.message || e) });
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
    recordError('export/image', e, { htmlLength: req.body?.html?.length ?? null });
    res.status(500).json({ error: 'Зураг үүсгэхэд алдаа гарлаа: ' + (e.message || e) });
  }
});

// Сүүлийн алдаанууд (оношилгоо)
app.get('/api/debug/errors', (_req, res) => {
  res.json({ errors: lastErrors });
});

// Сүүлд PDF болж чадаагүй HTML (оношилгоо)
app.get('/api/debug/last-html', async (_req, res) => {
  try {
    const { readFile } = await import('node:fs/promises');
    const html = await readFile('/tmp/last-failed.html', 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(html);
  } catch {
    res.status(404).json({ error: 'Бүртгэгдсэн HTML алга.' });
  }
});

// PDF хөдөлгүүрийн оношилгоо: Chromium ажиллаж буй эсэхийг шууд шалгана.
// Railway дээр GET /api/health/pdf гэж нээгээд үзэхэд хангалттай.
app.get('/api/health/pdf', async (_req, res) => {
  try {
    const started = Date.now();
    const buf = await htmlToPdf('<p>тест ok</p>', { lang: 'src' });
    res.json({ ok: true, bytes: buf.length, ms: Date.now() - started });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Глобал алдааны handler — body parser (JSON/хэмжээ) зэрэг route-оос өмнөх
// алдааг ч бүртгэж, ойлгомжтой JSON буцаана.
app.use((err, req, res, _next) => {
  console.error(err);
  recordError(req.path, err, { status: err.status || err.statusCode || 500 });
  res.status(err.status || err.statusCode || 500).json({ error: err.message || 'Сервер дээр алдаа гарлаа.' });
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

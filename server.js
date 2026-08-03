import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFile } from './lib/parse.js';
import { translateHtml, activeProvider } from './lib/translate.js';
import { htmlToDocx } from './lib/export.js';
import { htmlToPdf } from './lib/latex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Идэвхтэй орчуулгын провайдер
app.get('/api/config', (_req, res) => {
  res.json({ provider: activeProvider() });
});

// Файл оруулах -> HTML
app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл алга.' });
    const { html, warnings } = await parseFile(req.file);
    res.json({ html, warnings, name: req.file.originalname });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Орчуулга
app.post('/api/translate', async (req, res) => {
  try {
    const { html, target } = req.body || {};
    if (!html) return res.status(400).json({ error: 'html алга.' });
    const translated = await translateHtml(html, target);
    res.json({ html: translated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Word татах
app.post('/api/export/docx', async (req, res) => {
  try {
    const { html, title } = req.body || {};
    if (!html) return res.status(400).json({ error: 'html алга.' });
    const buffer = await htmlToDocx(html, title || 'Баримт');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="document.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PDF татах (LaTeX / tectonic — албан бичгийн стандарт хэлбэр)
app.post('/api/export/pdf', async (req, res) => {
  try {
    const { html, lang } = req.body || {};
    if (!html) return res.status(400).json({ error: 'html алга.' });
    const buffer = await htmlToPdf(html, lang || 'src');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="document-${lang || 'src'}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'PDF үүсгэхэд алдаа гарлаа: ' + (e.stderr || e.message) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Баримт-орчуулга веб → http://localhost:${PORT}`);
  console.log(`  Орчуулгын провайдер: ${activeProvider()}\n`);
});

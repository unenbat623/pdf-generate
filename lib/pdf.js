// HTML (editor) -> PDF via headless Chromium (WYSIWYG).
// Дизайн (өнгө, карт, диаграм, хүснэгт) яг байгаагаар гарна. Монгол/Япон фонт зөв.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeHtml } from './sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _docCss = null;
async function docCss() {
  if (_docCss == null) {
    _docCss = await fs.readFile(path.join(__dirname, '../public/doc-styles.css'), 'utf8');
  }
  return _docCss;
}

let _browser = null;
async function browser() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
  }
  return _browser;
}

// Фонт стек: Монгол Кирилл (ү/ө орно) + Япон + Латин
const FONT_STACK = `'Noto Sans', 'Noto Sans CJK JP', 'Noto Serif', 'Hiragino Sans', 'Yu Gothic', 'Helvetica Neue', Arial, sans-serif`;

export async function htmlToPdf(html, opts = {}) {
  const css = await docCss();
  const safeHtml = sanitizeHtml(html);
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: ${FONT_STACK}; color: #1a1a1a; font-size: 12pt; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  img { max-width: 100%; }
  ${css}
</style></head><body class="doc-body">${safeHtml}</body></html>`;

  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(doc, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf); // Uint8Array -> Buffer (Express-д зөв binary явуулах)
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (_browser?.connected) await _browser.close();
  _browser = null;
}

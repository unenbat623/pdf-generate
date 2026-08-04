// Export: HTML -> Word (.docx). PDF-ийг клиент талд хэвлэх (print) замаар гаргана.
import HTMLtoDOCX from 'html-to-docx';
import { sanitizeHtml } from './sanitize.js';

const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function htmlToDocx(html, title = 'Баримт') {
  const safeTitle = escapeHtml(title).slice(0, 120);
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body>${sanitizeHtml(html)}</body></html>`;
  const buffer = await HTMLtoDOCX(doc, null, {
    orientation: 'portrait',
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    title: safeTitle,
  });
  return buffer;
}

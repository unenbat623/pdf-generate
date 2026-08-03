// Export: HTML -> Word (.docx). PDF-ийг клиент талд хэвлэх (print) замаар гаргана.
import HTMLtoDOCX from 'html-to-docx';

export async function htmlToDocx(html, title = 'Баримт') {
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${html}</body></html>`;
  const buffer = await HTMLtoDOCX(doc, null, {
    orientation: 'portrait',
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    title,
  });
  return buffer;
}

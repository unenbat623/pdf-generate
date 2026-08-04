// Import parsers: docx / xlsx / pdf / image -> HTML (zurgiig base64-oor hadgalna)
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { officeToHtml } from './office.js';
import { sanitizeHtml } from './sanitize.js';

const escapeHtml = (s = '') =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- DOCX ----------
// mammoth: zurag boluud style-tai HTML gargana. Zuraguudiig base64 болгож шингээнэ.
async function parseDocx(buffer) {
  const { value, messages } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const b64 = await image.read('base64');
        return { src: `data:${image.contentType};base64,${b64}` };
      }),
    }
  );
  return { html: value, warnings: messages.map((m) => m.message) };
}

// ---------- XLSX ----------
// Excel-iin har sheet buriig HTML husnegt bolgono. Zurguudiig (xl/media) uunzip hiij nemne.
async function parseXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  let html = '';
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    html += `<h2>${escapeHtml(name)}</h2>`;
    html += XLSX.utils.sheet_to_html(ws, { header: '', footer: '' });
    html += '<br/>';
  }

  const warnings = [];
  // Embedded зургуудыг xlsx zip доторх xl/media/-ээс гаргаж ирнэ (байрлал бус, доор нэмнэ).
  try {
    const zip = await JSZip.loadAsync(buffer);
    const media = Object.keys(zip.files).filter(
      (p) => /^xl\/media\/.+\.(png|jpe?g|gif|bmp|webp)$/i.test(p) && !zip.files[p].dir
    );
    if (media.length) {
      html += '<h3>Зургууд</h3>';
      for (const p of media) {
        const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const b64 = await zip.files[p].async('base64');
        html += `<figure><img src="data:${mime};base64,${b64}" style="max-width:100%"/></figure>`;
      }
      warnings.push(
        `${media.length} зураг олдож доор нэмэгдлээ — Excel дэх байрлал нь хадгалагдаагүй тул шаардлагатай газарт нь чирж зөөнө үү.`
      );
    }
  } catch {
    /* зураг гаргаж чадсангүй — хүснэгт хэвээр */
  }
  return { html, warnings };
}

function cssNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : fallback;
}

function textItemHtml(item, viewport, pdfjs) {
  const text = item.str?.replace(/\s+/g, ' ');
  if (!text?.trim()) return '';

  const tx = pdfjs.Util.transform(viewport.transform, item.transform);
  const fontSize = cssNumber(Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 10, 10);
  const left = cssNumber(tx[4]);
  const top = cssNumber(tx[5] - fontSize);
  const width = cssNumber((item.width || text.length * fontSize * 0.5) * viewport.scale);
  const family = /serif/i.test(item.fontName || '') ? 'serif' : 'sans-serif';

  return `<span class="pdf-text" style="position:absolute; left:${left}px; top:${top}px; width:${width}px; font-size:${fontSize}px; line-height:1.05; font-family:${family}; white-space:pre; transform-origin:left top;">${escapeHtml(text)}</span>`;
}

// ---------- PDF ----------
// pdfjs-dist (legacy build) -> эх хуудсан дээрх байрлалаар editable text layer гаргана.
async function parsePdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  let html = '';
  let textCount = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1.333 });
    const content = await page.getTextContent();
    const pageItems = content.items.map((item) => textItemHtml(item, viewport, pdfjs)).filter(Boolean);
    textCount += pageItems.length;
    html += `<div class="pdf-page exact" data-page="${p}" style="position:relative; width:${cssNumber(viewport.width)}px; height:${cssNumber(viewport.height)}px; overflow:hidden;">${pageItems.join('')}</div>`;
    if (p < doc.numPages) html += '<hr class="page-break"/>';
  }
  const warnings =
    doc.numPages && textCount === 0
      ? ['PDF-д танигдах текст олдсонгүй. Скан/зураг PDF бол OCR шаардлагатай.']
      : ['PDF-г эх байрлалаар нь editable text layer болгон орууллаа. Скан зураг, complex vector/background зураг бүрэн сэргээгдэхгүй байж болно.'];
  return { html, warnings };
}

// ---------- IMAGE ----------
function parseImage(buffer, mime) {
  const b64 = buffer.toString('base64');
  const html = `<figure><img src="data:${mime};base64,${b64}" style="max-width:100%"/><figcaption>Зураг — тайлбар/текстээ энд бичнэ үү</figcaption></figure>`;
  return { html, warnings: [] };
}

export async function parseFile({ buffer, originalname, mimetype }) {
  const name = (originalname || '').toLowerCase();
  const ext = name.slice(name.lastIndexOf('.') + 1);

  const isDocx = ext === 'docx' || mimetype?.includes('word');
  const isXlsx = ext === 'xlsx' || ext === 'xls' || mimetype?.includes('sheet');

  // LibreOffice байвал эх хэвээр нь (fidelity), эс бол хуучин арга руу шилжинэ
  if (isDocx || isXlsx) {
    try {
      const lo = await officeToHtml(buffer, isDocx ? 'docx' : 'xlsx');
      if (lo && lo.html && lo.html.trim()) return { ...lo, html: sanitizeHtml(lo.html) };
    } catch (e) {
      console.error('LibreOffice import алдаа, fallback:', e.message);
    }
  }
  if (isDocx) {
    const parsed = await parseDocx(buffer);
    return { ...parsed, html: sanitizeHtml(parsed.html) };
  }
  if (isXlsx) {
    const parsed = await parseXlsx(buffer);
    return { ...parsed, html: sanitizeHtml(parsed.html) };
  }
  if (ext === 'pdf' || mimetype === 'application/pdf') {
    const parsed = await parsePdf(buffer);
    return { ...parsed, html: sanitizeHtml(parsed.html) };
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) || mimetype?.startsWith('image/'))
    return { ...parseImage(buffer, mimetype || 'image/png') };

  // fallback: enгийн текст
  return {
    html: `<pre>${escapeHtml(buffer.toString('utf8'))}</pre>`,
    warnings: ['Танигдаагүй файлын төрөл тул plain text байдлаар уншлаа.'],
  };
}

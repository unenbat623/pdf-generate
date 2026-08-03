// Import parsers: docx / xlsx / pdf / image -> HTML (zurgiig base64-oor hadgalna)
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

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

// ---------- PDF ----------
// pdfjs-dist (legacy build) -> хуудас бүрийн текст. Зохион байгуулалт бус, текст гаргана.
async function parsePdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  let html = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Y координатаар мөр болгон бүлэглэж, догол мөр сэргээх
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push(item.str);
    }
    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    html += `<div class="pdf-page" data-page="${p}">`;
    for (const [, parts] of ordered) {
      const text = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (text) html += `<p>${escapeHtml(text)}</p>`;
    }
    html += '</div>';
    if (p < doc.numPages) html += '<hr class="page-break"/>';
  }
  const warnings =
    doc.numPages && !html.includes('<p>')
      ? ['PDF-d tanij boloh text oldsongui — skan (zurag) PDF baij magadgui. OCR shaardlagatai.']
      : [];
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

  if (ext === 'docx' || mimetype?.includes('word')) return parseDocx(buffer);
  if (ext === 'xlsx' || ext === 'xls' || mimetype?.includes('sheet'))
    return parseXlsx(buffer);
  if (ext === 'pdf' || mimetype === 'application/pdf') return parsePdf(buffer);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) || mimetype?.startsWith('image/'))
    return parseImage(buffer, mimetype || 'image/png');

  // fallback: enгийн текст
  return { html: `<pre>${escapeHtml(buffer.toString('utf8'))}</pre>`, warnings: [] };
}

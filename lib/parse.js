// Импортын нэгдсэн диспетчер: Word / Excel / PowerPoint / PDF / OpenDocument /
// RTF / CSV / Markdown / HTML / текст / зураг → засварлаж болох HTML.
// Өргөтгөл буруу эсвэл байхгүй бол файлын эхний байтуудаас (magic) төрлийг таана.
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { officeToHtml } from './office.js';
import { sanitizeHtml } from './sanitize.js';
import { xlsxToHtml } from './xlsx.js';
import { pptxToHtml } from './pptx.js';
import { odfToHtml } from './odf.js';
import { rtfToHtml } from './rtf.js';
import { legacyDocToHtml } from './legacy-doc.js';
import { markdownToHtml } from './markdown.js';
import { escapeHtml } from './opc.js';
import { ocrAvailable, ocrImage, ocrPdf } from './ocr.js';

// ---------- төрөл таних ----------

const EXT_KIND = {
  docx: 'docx', docm: 'docx', dotx: 'docx',
  doc: 'doc', dot: 'doc',
  xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', xltm: 'xlsx',
  xls: 'xls', xlsb: 'xls', xlt: 'xls',
  pptx: 'pptx', pptm: 'pptx', potx: 'pptx',
  ppt: 'ppt',
  odt: 'odf', ods: 'odf', odp: 'odf', ott: 'odf', ots: 'odf', otp: 'odf',
  pdf: 'pdf',
  rtf: 'rtf',
  csv: 'csv', tsv: 'csv',
  md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html', xhtml: 'html',
  txt: 'text', log: 'text', json: 'text', xml: 'text', yml: 'text', yaml: 'text', srt: 'text', vtt: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXT_KIND);

function extensionOf(filename = '') {
  const name = String(filename).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1);
}

const startsWith = (buffer, bytes) => bytes.every((b, i) => buffer[i] === b);

/** Файлын эхний байтуудаас (болон zip доторх бүтцээс) бодит төрлийг тодорхойлно. */
async function sniffKind(buffer) {
  if (buffer.length < 4) return null;
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (buffer.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) return 'image';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image';
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'image';
  if (startsWith(buffer, [0x42, 0x4d])) return 'image';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0])) return 'cfb'; // хуучин Office (doc/xls/ppt)
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      if (zip.file('word/document.xml')) return 'docx';
      if (zip.file('xl/workbook.xml')) return 'xlsx';
      if (zip.file('ppt/presentation.xml')) return 'pptx';
      if (zip.file('content.xml')) return 'odf';
    } catch {
      /* zip биш байж магадгүй */
    }
  }
  return null;
}

/** CFB (хуучин Office) савны доторх урсгалаас Word/Excel/PowerPoint эсэхийг ялгана. */
function cfbKind(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 1 << 20)).toString('latin1');
  if (head.includes('W\0o\0r\0d\0D\0o\0c\0u\0m\0e\0n\0t')) return 'doc';
  if (head.includes('W\0o\0r\0k\0b\0o\0o\0k') || head.includes('B\0o\0o\0k')) return 'xls';
  if (head.includes('P\0o\0w\0e\0r\0P\0o\0i\0n\0t')) return 'ppt';
  return 'xls';
}

// ---------- нэг бүрчилсэн уншигчид ----------

async function parseDocx(buffer) {
  // LibreOffice суулгасан бол эх хэлбэрийг нь илүү сайн хадгална
  try {
    const lo = await officeToHtml(buffer, 'docx');
    if (lo?.html?.trim()) return lo;
  } catch (e) {
    console.error('LibreOffice docx алдаа, mammoth руу шилжлээ:', e.message);
  }
  // Хөтөч дээр харагдах зургийн төрлүүд — EMF/WMF (Word-ийн дотоод вектор) биш
  const RENDERABLE_IMG = /^image\/(png|jpe?g|gif|bmp|webp)$/i;
  let skippedImages = 0;
  const { value, messages } = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1.doc-title-line:fresh",
        "p[style-name='Subtitle'] => p.sub:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        'table => table.doc-datatable',
      ],
      convertImage: mammoth.images.imgElement(async (image) => {
        if (!RENDERABLE_IMG.test(image.contentType || '')) {
          skippedImages++;
          return { src: '', alt: '[дэмжигдээгүй форматын зураг]' };
        }
        const b64 = await image.read('base64');
        return { src: `data:${image.contentType};base64,${b64}`, style: 'max-width:100%; height:auto' };
      }),
    }
  );
  const warnings = messages
    .filter((m) => m.type === 'warning')
    .slice(0, 5)
    .map((m) => m.message);
  if (skippedImages) {
    warnings.push(
      `${skippedImages} зураг Word-ийн дотоод вектор (EMF/WMF) форматтай тул орж ирж чадсангүй. Word дээр тухайн зургийг сонгоод Copy → Paste Special → PNG болгож солиод хадгалбал орж ирнэ.`
    );
  }
  return { html: value, warnings };
}

function parseDelimited(buffer, ext) {
  const text = decodeText(buffer);
  const wb = XLSX.read(text, { type: 'string', FS: ext === 'tsv' ? '\t' : ',', raw: false });
  const name = wb.SheetNames[0];
  const html = XLSX.utils.sheet_to_html(wb.Sheets[name], { header: '', footer: '' });
  return { html: html.replace('<table', '<table class="doc-datatable"'), warnings: [] };
}

function parseHtmlFile(buffer) {
  const text = decodeText(buffer);
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(text);
  const styles = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => `<style>${m[1]}</style>`).join('');
  return { html: styles + (body ? body[1] : text), warnings: [] };
}

function parseText(buffer, ext) {
  const text = decodeText(buffer);
  if (ext === 'json') {
    try {
      return { html: `<pre>${escapeHtml(JSON.stringify(JSON.parse(text), null, 2))}</pre>`, warnings: [] };
    } catch {
      /* JSON биш — энгийн текст болгоно */
    }
  }
  if (ext === 'xml') return { html: `<pre>${escapeHtml(text)}</pre>`, warnings: [] };
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`);
  return { html: paragraphs.join('') || '<p></p>', warnings: [] };
}

async function parseImage(buffer, mime) {
  const b64 = buffer.toString('base64');
  const figure = (caption) =>
    `<figure><img src="data:${mime};base64,${b64}" style="max-width:100%"/><figcaption>${caption}</figcaption></figure>`;

  // AI OCR тохируулагдсан бол зургийн текстийг үг үсгээр нь уншиж HTML болгоно
  if (ocrAvailable()) {
    try {
      const html = await ocrImage(buffer, mime);
      if (html?.trim()) {
        return {
          html: html + '<hr/>' + figure('Эх зураг — дээрх текстийг тулгаж шалгаад энэ зургийг устгаж болно'),
          warnings: ['Зургийн текстийг AI уншиж, засварлаж болох болголоо. Үг үсгийг доорх эх зурагтай тулгаж шалгаарай.'],
        };
      }
    } catch (e) {
      return {
        html: figure('Зураг — тайлбар/текстээ энд бичнэ үү'),
        warnings: [`Зургийн текстийг AI-аар уншихад алдаа гарлаа: ${e.message}`],
      };
    }
  }
  return {
    html: figure('Зураг — тайлбар/текстээ энд бичнэ үү'),
    warnings: ['Зураг доторх текстийг автоматаар уншуулахыг хүсвэл .env-д RECONSTRUCT_PROVIDER=claude эсвэл gemini + API түлхүүр тохируулаарай.'],
  };
}

/** UTF-8 / UTF-16 / CP1251-ийг таньж текст болгоно (BOM болон Кирилл эвристик). */
function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  const utf8 = buffer.toString('utf8');
  // Орлуулах тэмдэгт олонтоо гарвал CP1251 (хуучин Монгол/Орос текст) гэж үзнэ
  const bad = (utf8.match(/�/g) || []).length;
  if (bad > 0 && bad / Math.max(1, utf8.length) > 0.002) {
    try {
      return new TextDecoder('windows-1251').decode(buffer);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

// ---------- PDF ----------

const cssNumber = (value, fallback = 0) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : fallback);

const colorDist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const rgbCss = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function textItemHtml(item, viewport, pdfjs, bg) {
  const text = item.str?.replace(/\s+/g, ' ');
  if (!text?.trim()) return '';

  const tx = pdfjs.Util.transform(viewport.transform, item.transform);
  const fontSize = cssNumber(Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 10, 10);
  const left = cssNumber(tx[4]);
  const top = cssNumber(tx[5] - fontSize);
  const width = cssNumber((item.width || text.length * fontSize * 0.5) * viewport.scale);
  const family = /serif/i.test(item.fontName || '') ? 'serif' : 'sans-serif';

  // Арын зурагтай үед: зураг дээрх хуучин текстийг ижил өнгийн дэвсгэрээр далдалж,
  // дээр нь засварлаж/орчуулж болох текст гарна. Дэвсгэр/үсгийн өнгийг зургаас дээжилнэ.
  let chip = ` width:${width}px;`;
  if (bg) {
    const back = bg.chipColor(left, top, width, fontSize);
    const ink = bg.inkColor(left, top, width, fontSize, back);
    chip = ` background:${rgbCss(back)}; color:${rgbCss(ink)}; min-width:${width}px; width:auto; padding-bottom:0.18em;`;
  }
  return `<span class="pdf-text" style="position:absolute; left:${left}px; top:${top}px;${chip} font-size:${fontSize}px; line-height:1.05; font-family:${family}; white-space:pre; transform-origin:left top;">${escapeHtml(text)}</span>`;
}

/** Хуудсыг зураг болгон рэндэрлэнэ (лого, хүснэгтийн хүрээ, дизайн бүгд гарна). */
async function renderPdfPage(page, viewport) {
  try {
    const { createCanvas } = await import('@napi-rs/canvas');
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const px = ctx.getImageData(0, 0, w, h).data;
    const jpeg = await canvas.encode('jpeg', 82);

    const at = (x, y) => {
      x = Math.min(w - 1, Math.max(0, Math.round(x)));
      y = Math.min(h - 1, Math.max(0, Math.round(y)));
      const i = (y * w + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };

    return {
      src: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      /** Текстийн хайрцгийн ГАДНАХ 4 цэгээс дэвсгэрийн өнгийг дээжилнэ (олонхи, тэнцвэл цайвар нь). */
      chipColor(left, top, width, fontSize) {
        const midY = top + fontSize * 0.55;
        const samples = [at(left - 3, midY), at(left + width + 3, midY), at(left + width / 2, top - 3), at(left + width / 2, top + fontSize * 1.2 + 3)];
        const counts = new Map();
        for (const c of samples) {
          const key = c.join(',');
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        let best = samples[0];
        let bestScore = -1;
        for (const c of samples) {
          const score = counts.get(c.join(',')) * 1000 + c[0] + c[1] + c[2];
          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }
        return best;
      },
      /** Үсгийн өнгө: хайрцгийн голч мөрөөс дэвсгэрээс хамгийн ялгаатай цэгийг олно (цагаан үсэгтэй хар мөр г.м.). */
      inkColor(left, top, width, fontSize, back) {
        const y = top + fontSize * 0.55;
        let best = [17, 17, 17];
        let bestDist = 0;
        const steps = Math.min(40, Math.max(8, Math.floor(width / 2)));
        for (let s = 0; s <= steps; s++) {
          const c = at(left + (width * s) / steps, y);
          const d = colorDist(c, back);
          if (d > bestDist) {
            bestDist = d;
            best = c;
          }
        }
        // Дэвсгэрээс бараг ялгараагүй бол энгийн хар үсэг
        return bestDist > 90 ? best : colorDist([17, 17, 17], back) > 90 ? [17, 17, 17] : [255, 255, 255];
      },
    };
  } catch (e) {
    console.error(`pdf: хуудас ${page.pageNumber} зураг болгоход алдаа:`, e.message);
    return null;
  }
}

async function parsePdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  let html = '';
  let textCount = 0;
  let renderedPages = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1.333 });
    const bg = await renderPdfPage(page, viewport);
    if (bg) renderedPages++;
    const content = await page.getTextContent();
    const pageItems = content.items.map((item) => textItemHtml(item, viewport, pdfjs, bg)).filter(Boolean);
    textCount += pageItems.length;
    const w = cssNumber(viewport.width);
    const h = cssNumber(viewport.height);
    const bgImg = bg
      ? `<img class="pdf-bg" src="${bg.src}" alt="" style="position:absolute; left:0; top:0; width:${w}px; height:${h}px;"/>`
      : '';
    html += `<div class="pdf-page exact" data-page="${p}" style="position:relative; width:${w}px; height:${h}px; overflow:hidden;">${bgImg}${pageItems.join('')}</div>`;
    if (p < doc.numPages) html += '<hr class="page-break"/>';
  }
  // Скан (текстгүй) PDF: AI OCR тохируулагдсан бол хуудсуудыг уншуулна
  if (doc.numPages && textCount === 0) {
    if (ocrAvailable()) {
      try {
        const ai = await ocrPdf(buffer);
        if (ai?.trim()) {
          return {
            html: ai,
            warnings: ['Скан PDF-ийн текстийг AI уншиж сэргээлээ. Үг үсгийг эх файлтай тулгаж шалгаарай.'],
          };
        }
      } catch (e) {
        return { html, warnings: [`Скан PDF-ийг AI-аар уншихад алдаа гарлаа: ${e.message}`] };
      }
    }
    return {
      html,
      warnings: [
        renderedPages
          ? 'Скан PDF-ийн хуудсуудыг зургаар орууллаа. Текстийг нь засварлаж болохоор уншуулахыг хүсвэл .env-д RECONSTRUCT_PROVIDER=claude эсвэл gemini + API түлхүүр тохируулаарай.'
          : 'PDF-д танигдах текст олдсонгүй (скан/зураг PDF). Текстийг нь автоматаар уншуулахыг хүсвэл .env-д RECONSTRUCT_PROVIDER=claude эсвэл gemini + API түлхүүр тохируулаарай.',
      ],
    };
  }
  return {
    html,
    warnings: [
      renderedPages
        ? 'PDF-г эх дизайнаар нь (лого, хүснэгт, зураг) орууллаа. Текст нь дээд давхаргад байгаа тул шууд засварлаж, орчуулж болно.'
        : 'PDF-г текст давхаргаар орууллаа. Лого/зураг рэндэрлэгдсэнгүй — серверийн лог шалгана уу.',
    ],
  };
}

// ---------- нэгдсэн орц ----------

export async function parseFile({ buffer, originalname, mimetype }) {
  const ext = extensionOf(originalname);
  let kind = EXT_KIND[ext] || null;

  // Өргөтгөл байхгүй/танигдаагүй, эсвэл zip-бус мэт бол агуулгаас нь шалгана
  const sniffed = await sniffKind(buffer);
  if (!kind) kind = sniffed;
  if (sniffed === 'cfb' && ['docx', 'xlsx', 'pptx', 'odf'].includes(kind)) kind = cfbKind(buffer);
  if (kind === 'cfb') kind = cfbKind(buffer);
  // Өргөтгөл нь docx гээд үнэндээ zip биш (жишээ нь .doc-г сольж нэрлэсэн) тохиолдол
  if (sniffed && sniffed !== 'cfb' && ['docx', 'xlsx', 'pptx', 'odf'].includes(kind) && sniffed !== kind) kind = sniffed;

  const finish = (result) => ({
    html: sanitizeHtml(result.html || ''),
    warnings: result.warnings || [],
  });

  switch (kind) {
    case 'docx':
      return finish(await parseDocx(buffer));
    case 'doc':
      try {
        return finish(legacyDocToHtml(buffer));
      } catch (e) {
        const lo = await officeToHtml(buffer, 'doc').catch(() => null);
        if (lo?.html?.trim()) return finish(lo);
        throw new Error(`Хуучин .doc файлыг уншиж чадсангүй (${e.message}). Word дээр нээж «.docx» болгож хадгалаад дахин оруулна уу.`);
      }
    case 'xlsx':
    case 'xls':
      return finish(await xlsxToHtml(buffer));
    case 'pptx':
      return finish(await pptxToHtml(buffer));
    case 'ppt':
      throw new Error('Хуучин .ppt формат дэмжигдэхгүй. PowerPoint дээр нээж «.pptx» болгож хадгалаад оруулна уу.');
    case 'odf':
      return finish(await odfToHtml(buffer, ext));
    case 'pdf':
      return finish(await parsePdf(buffer));
    case 'rtf':
      return finish({ html: rtfToHtml(buffer), warnings: [] });
    case 'csv':
      return finish(parseDelimited(buffer, ext));
    case 'markdown':
      return finish({ html: markdownToHtml(decodeText(buffer)), warnings: [] });
    case 'html':
      return finish(parseHtmlFile(buffer));
    case 'image':
      return finish(await parseImage(buffer, mimetype?.startsWith('image/') ? mimetype : 'image/png'));
    case 'text':
      return finish(parseText(buffer, ext));
    default:
      return finish({
        ...parseText(buffer, ext),
        warnings: [`«.${ext || '?'}» төрлийг таньсангүй тул энгийн текст байдлаар уншлаа.`],
      });
  }
}

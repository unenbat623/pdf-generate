// HTML (засварлагч) -> PDF, headless Chromium-аар (WYSIWYG).
// Дизайн (өнгө, карт, диаграм, хүснэгт) яг байгаагаар гарна. Монгол/Япон фонт зөв.
// Excel-ээс орж ирсэн өргөн хүснэгтийг автоматаар хэвтээ болгож, хуудсанд багтаана.
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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-extensions',
        '--font-render-hinting=none',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
  }
  return _browser;
}

// Chromium унасан/гацсан үед нэг удаа дахин эхлүүлж үзнэ (Railway дээр
// санах ой дутсанаас processes алагдах тохиолдол бий).
async function newPage() {
  try {
    const b = await browser();
    return await b.newPage();
  } catch (e) {
    console.error('pdf: browser эхлүүлэхэд алдаа, дахин оролдож байна:', e.message);
    await closeBrowser().catch(() => {});
    const b = await browser();
    return await b.newPage();
  }
}

// Фонт стек: Монгол Кирилл (ү/ө орно) + Япон + Латин
const FONT_STACK = `'Noto Sans', 'Carlito', 'Liberation Sans', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', 'Helvetica Neue', Arial, sans-serif`;

const MARGIN_MM = { top: 14, right: 12, bottom: 14, left: 12 };
const MM_TO_PX = 96 / 25.4;
const PRINTABLE_PX = {
  portrait: (210 - MARGIN_MM.left - MARGIN_MM.right) * MM_TO_PX, // ≈ 703px
  landscape: (297 - MARGIN_MM.left - MARGIN_MM.right) * MM_TO_PX, // ≈ 1032px
};

// Тэмдэглэл: хуудасны хэмжээ/захыг Puppeteer-т өгнө (preferCSSPageSize: false),
// тиймээс @page size энд бичихгүй — эс тэгвэл хэвтээ горим үл ажиллана.
const PRINT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${FONT_STACK}; color: #1a1a1a; font-size: 12pt; line-height: 1.55;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  img { max-width: 100%; height: auto; break-inside: avoid; }
  figure { margin: 6px 0; break-inside: avoid; }
  /* Хуудас таслах тэмдэг */
  hr.page-break { border: 0; height: 0; margin: 0; break-after: page; page-break-after: always; }
  /* Хүснэгт: мөр дундуур таслахгүй, толгойг хуудас бүрт давтана */
  table { break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
  .xl-sheet-title { font-size: 14pt; margin: 0 0 6px; }
  .xl-sheet td { word-break: break-word; }
  .pptx-slide { break-inside: avoid; }
`;

export async function htmlToPdf(html, opts = {}) {
  try {
    return await renderPdf(html, opts);
  } catch (e) {
    if (opts._retried) throw e;
    // Chromium унасан байж болзошгүй (жишээ нь санах ой дутсан) —
    // шинэ browser-ээр нэг удаа дахин оролдоно.
    console.error('pdf: эхний оролдлого амжилтгүй, browser-ийг шинэчилж дахин оролдоно:', e.message);
    await closeBrowser().catch(() => {});
    return htmlToPdf(html, { ...opts, _retried: true });
  }
}

async function renderPdf(html, opts = {}) {
  const css = await docCss();
  const safeHtml = sanitizeHtml(html);
  const doc = `<!DOCTYPE html><html lang="${opts.lang === 'ja' ? 'ja' : opts.lang === 'en' ? 'en' : 'mn'}"><head><meta charset="utf-8">
<style>${PRINT_CSS}\n${css}</style></head><body class="doc-body">${safeHtml}</body></html>`;

  const page = await newPage();
  try {
    // Хэмжилтийг ХӨРӨӨС нь хийхийн тулд viewport-ыг босоо A4-ийн хэвлэгдэх өргөнөөр
    // тавина. Ингэснээр body өөрөө viewport-ыг дүүргэхгүй, зөвхөн жинхэнэ агуулга
    // (тогтмол өргөнтэй хүснэгт гэх мэт) хэтэрч байвал л илэрнэ.
    await page.setViewport({ width: Math.round(PRINTABLE_PX.portrait), height: 1200 });
    await page.setContent(doc, { waitUntil: 'load', timeout: 60000 });
    // Бүх зураг ачаалж дуустал хүлээнэ (data URI ч гэсэн)
    await page.evaluate(async () => {
      await document.fonts.ready;
      const images = [...document.images].filter((img) => !img.complete);
      await Promise.all(
        images.map(
          (img) =>
            new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
              setTimeout(resolve, 5000);
            })
        )
      );
    });

    // Хүснэгт бүрийн СҮҮЛИЙН хоосон мөрүүдийг хасна. Excel-ээс ирсэн хуудсууд
    // мянга мянган хоосон мөртэй байх нь бий — тэдгээр нь PDF-ийг хэдэн зуун
    // хоосон хуудас болгож, Chromium-ийн хэвлэлтийг унагадаг.
    const prunedRows = await page.evaluate(() => {
      let removed = 0;
      for (const table of document.querySelectorAll('table')) {
        const rows = [...table.rows];
        const isEmpty = (tr) => !tr.textContent.trim() && !tr.querySelector('img');
        let last = rows.length - 1;
        while (last >= 0 && isEmpty(rows[last])) last--;
        for (let i = rows.length - 1; i > last; i--) {
          rows[i].remove();
          removed++;
        }
      }
      return removed;
    });
    if (prunedRows) console.log(`pdf: хүснэгтийн сүүлийн ${prunedRows} хоосон мөрийг хаслаа`);

    const measure = () =>
      page.evaluate(() => {
        let widest = document.documentElement.scrollWidth;
        for (const el of document.querySelectorAll('table, .pdf-page, pre, figure, img')) {
          widest = Math.max(widest, Math.ceil(el.getBoundingClientRect().width || 0));
        }
        return Math.ceil(widest);
      });

    const contentWidth = await measure();

    // Босоо хэвлэлтийг илүүд үзнэ. Зөвхөн мэдэгдэхүйц өргөн (жишээ нь Excel-ийн
    // олон баганатай хуудас) үед л хэвтээ рүү шилжинэ — эс тэгвэл жирийн бичиг
    // хүртэл хэвтээ гараад ирнэ.
    const landscape = opts.landscape ?? contentWidth > PRINTABLE_PX.portrait * 1.25;
    const printable = Math.floor(landscape ? PRINTABLE_PX.landscape : PRINTABLE_PX.portrait);

    // Өргөн блок бүрийг ТУС ТУСАД нь багтаана. Бүх баримтыг нэг масштабаар
    // жижигрүүлбэл нарийн хуудсууд нь ч уншигдахгүй болно. `zoom` нь `transform`-оос
    // ялгаатай нь layout-ыг дахин тооцдог тул хуудас таслалт хэвийн ажиллана.
    const zoomed = await page.evaluate((limit) => {
      let count = 0;
      for (const el of document.querySelectorAll('table.xl-sheet, .pdf-page, pre, table')) {
        const width = el.getBoundingClientRect().width;
        if (width > limit + 1) {
          el.style.zoom = String(Math.max(0.3, limit / width));
          count++;
        }
      }
      return count;
    }, printable);

    const remaining = await measure();
    // Дараад үлдсэн хэтрэлтийг (жишээ нь маш өргөн зураг) бүхэлд нь багтаана
    const scale = remaining > printable ? Math.max(0.35, Math.min(1, printable / remaining)) : 1;
    console.log(
      `pdf: агуулга ${contentWidth}px → ${landscape ? 'хэвтээ' : 'босоо'} A4, ${zoomed} блок багтаалаа, ерөнхий масштаб ${scale.toFixed(2)}`
    );

    const pdf = await page.pdf({
      format: 'A4',
      landscape,
      scale,
      printBackground: true,
      margin: {
        top: `${MARGIN_MM.top}mm`,
        right: `${MARGIN_MM.right}mm`,
        bottom: `${MARGIN_MM.bottom}mm`,
        left: `${MARGIN_MM.left}mm`,
      },
      preferCSSPageSize: false,
      timeout: 120000,
    });
    return Buffer.from(pdf); // Uint8Array -> Buffer (Express-д зөв binary явуулах)
  } finally {
    await page.close();
  }
}

/**
 * HTML → хуудас тус бүрийн PNG зургууд. PDF экспортын хөдөлгүүрийг ашигладаг тул
 * хуудаслалт, хэвтээ/босоо, багтаалт бүгд PDF-тэй яг ижил гарна.
 */
export async function htmlToImages(html, opts = {}) {
  const pdf = await htmlToPdf(html, opts);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  const images = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 }); // A4 → ~1190×1684px (144dpi, хурц)
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(await canvas.encode('png'));
  }
  return images;
}

export async function closeBrowser() {
  if (_browser?.connected) await _browser.close();
  _browser = null;
}

// Excel (.xlsx/.xlsm) → HTML, ЭХ БАЙДЛААР нь: зураг бүр өөрийн anchor нүдэн дээрээ,
// баганын өргөн / мөрийн өндөр / нийлүүлсэн нүд / фонт / өнгө / хүрээ хадгалагдана.
// LibreOffice шаардахгүй — бүгд zip + XML-ээс шууд.
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { child, children, findAll, attr, num, textOf } from './xml.js';
import { readRels, readXml, imageDataUri, emuToPx, escapeHtml } from './opc.js';
import { buildStyleTable } from './xlsx-style.js';

const DEFAULT_ROW_PX = 20; // 15pt
const MAX_COLS = 256;
const MAX_ROWS = 5000;

// ---------- хэмжээсийн хөрвүүлэлт ----------

// Excel-ийн "тэмдэгтийн өргөн" → пиксел. MDW = үндсэн фонтын хамгийн өргөн цифр.
function colCharsToPx(chars, mdw) {
  return Math.trunc(((256 * chars + Math.trunc(128 / mdw)) / 256) * mdw);
}

// Үндсэн фонтын хэмжээнээс MDW-г ойролцоолно (Calibri 11 → 7px).
function maxDigitWidth(font) {
  const pt = font?.size || 11;
  return Math.max(5, Math.min(20, Math.round((pt / 11) * 7)));
}

const ptToPx = (pt) => Math.round((Number(pt) || 0) * (96 / 72));

function colLetter(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function addr(row, col) {
  return colLetter(col) + (row + 1);
}

function parseRef(ref = '') {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

function parseRange(ref = '') {
  const [a, b] = ref.split(':');
  const s = parseRef(a);
  const e = parseRef(b || a);
  return s && e ? { s, e } : null;
}

// ---------- worksheet XML ----------

function readWorksheet(xmlRoot, mdw) {
  const ws = findAll(xmlRoot, 'worksheet')[0] || xmlRoot;
  const fmt = child(ws, 'sheetFormatPr');
  const defaultRowPx = fmt && attr(fmt, 'defaultRowHeight') ? ptToPx(attr(fmt, 'defaultRowHeight')) : DEFAULT_ROW_PX;
  const defaultColPx = fmt && attr(fmt, 'defaultColWidth')
    ? colCharsToPx(num(attr(fmt, 'defaultColWidth'), 8.43), mdw)
    : colCharsToPx(8.43, mdw);

  const cols = [];
  for (const col of children(child(ws, 'cols'), 'col')) {
    const min = num(attr(col, 'min'), 1);
    const max = Math.min(num(attr(col, 'max'), min), MAX_COLS);
    const width = attr(col, 'width');
    const px = width !== undefined ? colCharsToPx(num(width, 8.43), mdw) : defaultColPx;
    for (let c = min - 1; c <= max - 1 && c < MAX_COLS; c++) {
      cols[c] = {
        px: Math.max(0, px),
        hidden: attr(col, 'hidden') === '1' || px === 0,
        style: attr(col, 'style') !== undefined ? num(attr(col, 'style'), 0) : null,
      };
    }
  }

  const rows = new Map();
  let maxRow = -1;
  let maxCol = -1;
  for (const row of children(child(ws, 'sheetData'), 'row')) {
    const r = num(attr(row, 'r'), rows.size + 1) - 1;
    if (r < 0 || r >= MAX_ROWS) continue;
    const cells = new Map();
    for (const c of children(row, 'c')) {
      const ref = parseRef(attr(c, 'r') || '');
      const ci = ref ? ref.col : cells.size;
      if (ci >= MAX_COLS) continue;
      cells.set(ci, { style: attr(c, 's') !== undefined ? num(attr(c, 's'), 0) : null });
      if (ci > maxCol) maxCol = ci;
    }
    rows.set(r, {
      px: attr(row, 'ht') !== undefined ? ptToPx(attr(row, 'ht')) : null,
      hidden: attr(row, 'hidden') === '1',
      style: attr(row, 'customFormat') === '1' && attr(row, 's') !== undefined ? num(attr(row, 's'), 0) : null,
      cells,
    });
    if (r > maxRow) maxRow = r;
  }

  const merges = [];
  for (const m of children(child(ws, 'mergeCells'), 'mergeCell')) {
    const range = parseRange(attr(m, 'ref') || '');
    if (range) merges.push(range);
  }

  const hyperlinks = new Map();
  for (const h of children(child(ws, 'hyperlinks'), 'hyperlink')) {
    const range = parseRange(attr(h, 'ref') || '');
    if (!range) continue;
    hyperlinks.set(`${range.s.row},${range.s.col}`, { rid: attr(h, 'id'), location: attr(h, 'location') });
  }

  const drawing = child(ws, 'drawing');
  const legacyDrawing = child(ws, 'legacyDrawing');

  return {
    cols,
    rows,
    merges,
    hyperlinks,
    maxRow,
    maxCol,
    defaultRowPx,
    defaultColPx,
    drawingRid: drawing ? attr(drawing, 'id') : null,
    hasLegacyDrawing: !!legacyDrawing,
  };
}

// ---------- drawing (зургийн байрлал) ----------

function anchorPoint(node) {
  if (!node) return null;
  return {
    col: num(textOf(child(node, 'col')), 0),
    colOff: num(textOf(child(node, 'colOff')), 0),
    row: num(textOf(child(node, 'row')), 0),
    rowOff: num(textOf(child(node, 'rowOff')), 0),
  };
}

function extentOf(node) {
  const ext = child(node, 'ext');
  if (!ext) return null;
  return { cx: num(attr(ext, 'cx'), 0), cy: num(attr(ext, 'cy'), 0) };
}

/** drawingN.xml-ийг уншиж anchor бүрийг { from, to, ext, embedRid, name, kind } болгоно. */
function readDrawing(xmlRoot) {
  const wsDr = findAll(xmlRoot, 'wsDr')[0] || xmlRoot;
  const out = [];
  for (const anchor of children(wsDr)) {
    const kindName = anchor.local;
    if (!/Anchor$/.test(kindName)) continue;
    const from = anchorPoint(child(anchor, 'from'));
    const to = anchorPoint(child(anchor, 'to'));
    const ext = extentOf(anchor); // one-cell / absolute anchor
    const pos = child(anchor, 'pos');

    const pic = child(anchor, 'pic');
    const shape = child(anchor, 'sp');
    const frame = child(anchor, 'graphicFrame');

    if (pic) {
      const blip = findAll(pic, 'blip')[0];
      const nv = findAll(pic, 'cNvPr')[0];
      const xfrmExt = extentOf(findAll(pic, 'xfrm')[0]);
      out.push({
        kind: 'pic',
        anchorKind: kindName,
        from,
        to,
        ext: ext || xfrmExt,
        absPos: pos ? { x: num(attr(pos, 'x'), 0), y: num(attr(pos, 'y'), 0) } : null,
        embedRid: blip ? attr(blip, 'embed') || attr(blip, 'link') : null,
        name: nv ? attr(nv, 'descr') || attr(nv, 'name') || '' : '',
      });
    } else if (shape) {
      const text = textOf(child(shape, 'txBody')).trim();
      if (text) out.push({ kind: 'shape', anchorKind: kindName, from, to, ext, text });
    } else if (frame) {
      const nv = findAll(frame, 'cNvPr')[0];
      out.push({ kind: 'frame', anchorKind: kindName, from, to, ext, name: nv ? attr(nv, 'name') || '' : '' });
    }
  }
  return out;
}

// ---------- нүдний агуулга ----------

function cellHtml(cell) {
  if (!cell) return '';
  if (cell.t === 'e') return escapeHtml(String(cell.w || cell.v || ''));
  let html;
  if ((cell.t === 's' || cell.t === 'str') && typeof cell.h === 'string' && cell.h) {
    html = cell.h; // SheetJS-ийн rich-text HTML (тод/налуу нүдэн доторх хэлбэрүүд)
  } else {
    const value = cell.w != null ? cell.w : cell.v;
    if (value == null || value === '') return '';
    html = escapeHtml(String(value));
  }
  return html.replace(/\r\n|\r|\n/g, '<br/>');
}

// ---------- үндсэн рэндэр ----------

export async function xlsxToHtml(buffer) {
  const warnings = [];
  const wb = XLSX.read(buffer, { type: 'buffer', cellHTML: true, cellDates: true, dense: false });

  let zip = null;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    zip = null;
  }
  // .xls гэх мэт zip бус хуучин формат → SheetJS-ийн энгийн хүснэгт рүү
  if (!zip || !zip.file('xl/workbook.xml')) {
    return { html: simpleWorkbookHtml(wb), warnings: ['Хуучин Excel формат тул хялбаршуулсан хүснэгт болгон уншлаа (зураг дэмжигдэхгүй). .xlsx болгож хадгалбал бүрэн гарна.'] };
  }

  const stylesXml = zip.file('xl/styles.xml') ? await zip.file('xl/styles.xml').async('string') : null;
  const themeFile = zip.file('xl/theme/theme1.xml') || zip.file(/^xl\/theme\/theme\d*\.xml$/)[0];
  const themeXml = themeFile ? await themeFile.async('string') : null;
  const styles = buildStyleTable(stylesXml, themeXml);
  const mdw = maxDigitWidth(styles.baseFont);

  const wbRoot = await readXml(zip, 'xl/workbook.xml');
  const wbRels = await readRels(zip, 'xl/workbook.xml');
  const sheetNodes = children(child(findAll(wbRoot, 'workbook')[0] || wbRoot, 'sheets'), 'sheet');

  const imgCache = new Map();
  const parts = [];
  let hiddenSheets = 0;
  let placedImages = 0;
  let skippedImages = 0;
  let chartCount = 0;

  for (let i = 0; i < sheetNodes.length; i++) {
    const node = sheetNodes[i];
    const name = attr(node, 'name') || wb.SheetNames[i] || `Sheet${i + 1}`;
    const state = attr(node, 'state') || 'visible';
    if (state !== 'visible') {
      hiddenSheets++;
      continue;
    }
    const rid = attr(node, 'id');
    const partPath = (rid && wbRels[rid]?.target) || `xl/worksheets/sheet${i + 1}.xml`;
    const sheetXml = await readXml(zip, partPath);
    if (!sheetXml) continue;

    const meta = readWorksheet(sheetXml, mdw);
    const sjsSheet = wb.Sheets[wb.SheetNames[i]] || wb.Sheets[name] || {};
    const sheetRels = await readRels(zip, partPath);

    // Зургууд
    let anchors = [];
    if (meta.drawingRid && sheetRels[meta.drawingRid]) {
      const drawPath = sheetRels[meta.drawingRid].target;
      const drawXml = await readXml(zip, drawPath);
      if (drawXml) {
        const drawRels = await readRels(zip, drawPath);
        for (const a of readDrawing(drawXml)) {
          if (a.kind === 'frame') {
            chartCount++;
            continue;
          }
          if (a.kind === 'pic') {
            const rel = a.embedRid ? drawRels[a.embedRid] : null;
            a.src = rel && !rel.external ? await imageDataUri(zip, rel.target, imgCache) : null;
            if (!a.src) {
              skippedImages++;
              continue;
            }
          }
          anchors.push(a);
        }
      }
    }

    const html = renderSheet({ name, meta, sjsSheet, styles, anchors, sheetRels });
    placedImages += html.placed;
    parts.push(html.html);
  }

  if (chartCount) warnings.push(`${chartCount} диаграм/объект нь зураг биш тул орж ирээгүй. Шаардлагатай бол Excel дээр зургаар хадгалж дахин оруулна уу.`);
  if (skippedImages) warnings.push(`${skippedImages} зургийг унших боломжгүй байлаа (EMF/WMF эсвэл хэт том).`);
  if (hiddenSheets) warnings.push(`${hiddenSheets} нуугдсан хуудсыг алгаслаа.`);
  if (placedImages) warnings.push(`${placedImages} зургийг Excel дэх нүдэнд нь яг байрлууллаа.`);
  if (!parts.length) warnings.push('Харагдах хуудас олдсонгүй.');

  return { html: parts.join('<hr class="page-break"/>'), warnings };
}

function renderSheet({ name, meta, sjsSheet, styles, anchors, sheetRels }) {
  // --- хүрээ тодорхойлох (агуулга + зургууд) ---
  let maxRow = meta.maxRow;
  let maxCol = meta.maxCol;
  const sjsRange = sjsSheet['!ref'] ? XLSX.utils.decode_range(sjsSheet['!ref']) : null;
  if (sjsRange) {
    maxRow = Math.max(maxRow, sjsRange.e.r);
    maxCol = Math.max(maxCol, sjsRange.e.c);
  }
  for (const m of meta.merges) {
    maxRow = Math.max(maxRow, m.e.row);
    maxCol = Math.max(maxCol, m.e.col);
  }
  for (const a of anchors) {
    if (a.from) {
      maxRow = Math.max(maxRow, a.to ? a.to.row : a.from.row);
      maxCol = Math.max(maxCol, a.to ? a.to.col : a.from.col);
    }
  }
  maxRow = Math.min(maxRow, MAX_ROWS - 1);
  maxCol = Math.min(maxCol, MAX_COLS - 1);
  if (maxRow < 0 || maxCol < 0) {
    return { html: `<h2 class="xl-sheet-title">${escapeHtml(name)}</h2><p><em>(хоосон хуудас)</em></p>`, placed: 0 };
  }

  const colPx = [];
  const colHidden = [];
  for (let c = 0; c <= maxCol; c++) {
    const info = meta.cols[c];
    colPx[c] = info ? info.px : meta.defaultColPx;
    colHidden[c] = info ? info.hidden : false;
  }
  const rowPx = [];
  const rowHidden = [];
  for (let r = 0; r <= maxRow; r++) {
    const info = meta.rows.get(r);
    rowPx[r] = info && info.px != null ? info.px : meta.defaultRowPx;
    rowHidden[r] = info ? info.hidden : false;
  }

  // --- зургийг нүдэнд хуваарилах ---
  const cellExtras = new Map(); // "r,c" → HTML мөрүүд
  let placed = 0;

  const cumulative = (arr, upto) => {
    let sum = 0;
    for (let i = 0; i < upto && i < arr.length; i++) sum += arr[i];
    return sum;
  };
  const nearestVisible = (hidden, index, limit) => {
    for (let i = index; i <= limit; i++) if (!hidden[i]) return i;
    for (let i = index; i >= 0; i--) if (!hidden[i]) return i;
    return 0;
  };

  for (const a of anchors) {
    let from = a.from;
    if (!from && a.absPos) {
      // absoluteAnchor: EMU байрлалыг хуримтлагдсан өргөн/өндрөөр нүд рүү буулгана
      const x = emuToPx(a.absPos.x);
      const y = emuToPx(a.absPos.y);
      let c = 0;
      let acc = 0;
      while (c < maxCol && acc + colPx[c] <= x) acc += colPx[c++];
      let r = 0;
      acc = 0;
      while (r < maxRow && acc + rowPx[r] <= y) acc += rowPx[r++];
      from = { row: r, col: c, colOff: 0, rowOff: 0 };
    }
    if (!from) continue;

    let row = Math.max(0, Math.min(from.row, maxRow));
    let col = Math.max(0, Math.min(from.col, maxCol));

    // Өргөн/өндрийг anchor-оос тооцно (twoCellAnchor), эс бол ext-ээс
    let widthPx = 0;
    let heightPx = 0;
    if (a.to) {
      const x1 = cumulative(colPx, from.col) + emuToPx(from.colOff);
      const x2 = cumulative(colPx, a.to.col) + emuToPx(a.to.colOff);
      const y1 = cumulative(rowPx, from.row) + emuToPx(from.rowOff);
      const y2 = cumulative(rowPx, a.to.row) + emuToPx(a.to.rowOff);
      widthPx = x2 - x1;
      heightPx = y2 - y1;
    }
    if (widthPx <= 1 && a.ext) widthPx = emuToPx(a.ext.cx);
    if (heightPx <= 1 && a.ext) heightPx = emuToPx(a.ext.cy);

    // Нийлүүлсэн нүдний дотор байвал үндсэн (зүүн дээд) нүд рүү нь шилжүүлнэ
    for (const m of meta.merges) {
      if (row >= m.s.row && row <= m.e.row && col >= m.s.col && col <= m.e.col) {
        row = m.s.row;
        col = m.s.col;
        break;
      }
    }
    if (rowHidden[row]) row = nearestVisible(rowHidden, row, maxRow);
    if (colHidden[col]) col = nearestVisible(colHidden, col, maxCol);

    const key = `${row},${col}`;
    const list = cellExtras.get(key) || [];
    if (a.kind === 'pic') {
      const size = widthPx > 1 ? ` width:${widthPx}px;` : '';
      list.push(
        `<img class="xl-pic" src="${a.src}" alt="${escapeHtml(a.name || 'зураг')}" style="display:block;${size} max-width:100%; margin:2px 0;"/>`
      );
      placed++;
    } else if (a.kind === 'shape') {
      list.push(`<div class="xl-shape">${escapeHtml(a.text).replace(/\n/g, '<br/>')}</div>`);
    }
    cellExtras.set(key, list);
  }

  // --- merge-ийн зураглал ---
  const spanAt = new Map(); // "r,c" → {rowspan, colspan}
  const covered = new Set();
  for (const m of meta.merges) {
    for (let r = m.s.row; r <= m.e.row && r <= maxRow; r++) {
      for (let c = m.s.col; c <= m.e.col && c <= maxCol; c++) {
        if (r === m.s.row && c === m.s.col) continue;
        covered.add(`${r},${c}`);
      }
    }
    spanAt.set(`${m.s.row},${m.s.col}`, m);
  }

  // --- HTML ---
  const visibleCols = [];
  for (let c = 0; c <= maxCol; c++) if (!colHidden[c]) visibleCols.push(c);
  const totalWidth = visibleCols.reduce((sum, c) => sum + colPx[c], 0);

  const out = [];
  out.push(`<h2 class="xl-sheet-title">${escapeHtml(name)}</h2>`);
  out.push(`<table class="xl-sheet" style="width:${totalWidth}px; table-layout:fixed; border-collapse:collapse;">`);
  out.push('<colgroup>' + visibleCols.map((c) => `<col style="width:${colPx[c]}px"/>`).join('') + '</colgroup>');
  out.push('<tbody>');

  for (let r = 0; r <= maxRow; r++) {
    if (rowHidden[r]) continue;
    const rowMeta = meta.rows.get(r);
    const cells = [];
    for (const c of visibleCols) {
      const key = `${r},${c}`;
      if (covered.has(key)) continue;

      const merge = spanAt.get(key);
      let colspan = 1;
      let rowspan = 1;
      if (merge) {
        // Нуугдсан мөр/багана нь HTML-д огт гарахгүй тул зөвхөн харагдахыг нь тоолно
        colspan = 0;
        for (const x of visibleCols) if (x >= merge.s.col && x <= merge.e.col) colspan++;
        rowspan = 0;
        for (let rr = merge.s.row; rr <= Math.min(merge.e.row, maxRow); rr++) if (!rowHidden[rr]) rowspan++;
        colspan = Math.max(1, colspan);
        rowspan = Math.max(1, rowspan);
      }

      const cell = sjsSheet[addr(r, c)];
      const styleIdx =
        rowMeta?.cells.get(c)?.style ??
        rowMeta?.style ??
        (meta.cols[c] ? meta.cols[c].style : null);
      const isNumber = cell ? cell.t === 'n' : false;
      const st = styles.cssFor(styleIdx == null ? -1 : styleIdx, { isNumber });

      let inner = cellHtml(cell);
      const link = meta.hyperlinks.get(key);
      if (link && inner) {
        const href = link.rid && sheetRels[link.rid] ? sheetRels[link.rid].target : link.location ? `#${link.location}` : '';
        if (/^https?:|^mailto:/i.test(href)) inner = `<a href="${escapeHtml(href)}" target="_blank">${inner}</a>`;
      }
      const extras = cellExtras.get(key);
      if (extras) inner += extras.join('');

      const styleAttr = [st.css, 'padding: 2px 4px', 'overflow-wrap: break-word', st.wrap ? 'white-space: pre-wrap' : '']
        .filter(Boolean)
        .join('; ');
      const spanAttrs = (colspan > 1 ? ` colspan="${colspan}"` : '') + (rowspan > 1 ? ` rowspan="${rowspan}"` : '');
      cells.push(`<td${spanAttrs} style="${styleAttr}">${inner || '&nbsp;'}</td>`);
    }
    if (!cells.length) continue;
    out.push(`<tr style="height:${rowPx[r]}px">${cells.join('')}</tr>`);
  }

  out.push('</tbody></table>');
  return { html: out.join(''), placed };
}

// .xls болон zip бус эх сурвалжид зориулсан хялбар хувилбар
function simpleWorkbookHtml(wb) {
  let html = '';
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    html += `<h2 class="xl-sheet-title">${escapeHtml(name)}</h2>`;
    // doc-datatable класс өгснөөр PDF/Word дээр хүснэгтийн хүрээ гарна
    html += XLSX.utils.sheet_to_html(ws, { header: '', footer: '' }).replace('<table', '<table class="doc-datatable"');
  }
  return html;
}

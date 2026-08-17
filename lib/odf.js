// OpenDocument (.odt / .ods / .odp) → HTML. LibreOffice/Google Docs-оос гарсан файлууд.
import JSZip from 'jszip';
import { child, children, childNodes, findAll, attr, num, TEXT_NODE } from './xml.js';
import { readXml, imageDataUri, escapeHtml, mimeForPath, RENDERABLE } from './opc.js';

const MAX_REPEAT = 200; // number-columns-repeated нь 1024/1048576 гэж ирдэг — хязгаарлана

async function imageFor(zip, node, cache) {
  const img = findAll(node, 'image')[0];
  if (!img) return null;
  const href = attr(img, 'href') || '';
  if (!href || /^https?:/i.test(href)) return null;
  const path = href.replace(/^\.?\//, '');
  if (!RENDERABLE.has(mimeForPath(path))) return null;
  return imageDataUri(zip, path, cache);
}

// Текст болон дотоод элементүүдийг ЭХ ДАРААЛЛААР нь нэгтгэнэ
function inlineText(node) {
  let out = '';
  for (const kid of childNodes(node)) {
    switch (kid.local) {
      case TEXT_NODE:
        out += escapeHtml(kid.text);
        break;
      case 'span':
        out += inlineText(kid);
        break;
      case 'a':
        out += `<a href="${escapeHtml(attr(kid, 'href') || '#')}" target="_blank">${inlineText(kid)}</a>`;
        break;
      case 'line-break':
        out += '<br/>';
        break;
      case 's':
        out += '&nbsp;'.repeat(Math.min(num(attr(kid, 'c'), 1), 20));
        break;
      case 'tab':
        out += '&nbsp;&nbsp;&nbsp;&nbsp;';
        break;
      case 'frame':
      case 'note':
        break; // зургийг тусад нь боловсруулна
      default:
        out += inlineText(kid);
    }
  }
  return out;
}

async function blockHtml(node, zip, cache, depth = 0) {
  if (depth > 20) return '';
  switch (node.local) {
    case 'h': {
      const level = Math.min(Math.max(num(attr(node, 'outline-level'), 1), 1), 6);
      const text = inlineText(node).trim();
      return text ? `<h${level}>${text}</h${level}>` : '';
    }
    case 'p': {
      const frames = findAll(node, 'frame');
      let media = '';
      for (const frame of frames) {
        const src = await imageFor(zip, frame, cache);
        if (src) media += `<figure><img src="${src}" style="max-width:100%"/></figure>`;
      }
      const text = inlineText(node).trim();
      if (!text && !media) return '';
      return (text ? `<p>${text}</p>` : '') + media;
    }
    case 'list': {
      const items = [];
      for (const item of children(node, 'list-item')) {
        let inner = '';
        for (const kid of children(item)) inner += await blockHtml(kid, zip, cache, depth + 1);
        items.push(`<li>${inner}</li>`);
      }
      return items.length ? `<ul>${items.join('')}</ul>` : '';
    }
    case 'table':
      return tableHtml(node, zip, cache, depth);
    case 'frame': {
      const src = await imageFor(zip, node, cache);
      return src ? `<figure><img src="${src}" style="max-width:100%"/></figure>` : '';
    }
    case 'section': {
      let inner = '';
      for (const kid of children(node)) inner += await blockHtml(kid, zip, cache, depth + 1);
      return inner;
    }
    default:
      return '';
  }
}

async function tableHtml(table, zip, cache, depth = 0) {
  const rows = [];
  const collectRows = (node) => {
    const out = [];
    for (const kid of children(node)) {
      if (kid.local === 'table-row') out.push(kid);
      else if (/header-rows|row-group/.test(kid.local)) out.push(...collectRows(kid));
    }
    return out;
  };
  for (const tr of collectRows(table)) {
    const repeatRow = Math.min(num(attr(tr, 'number-rows-repeated'), 1), MAX_REPEAT);
    const cells = [];
    for (const tc of children(tr)) {
      if (tc.local !== 'table-cell' && tc.local !== 'covered-table-cell') continue;
      const repeat = Math.min(num(attr(tc, 'number-columns-repeated'), 1), MAX_REPEAT);
      if (tc.local === 'covered-table-cell') continue;
      const colspan = num(attr(tc, 'number-columns-spanned'), 1);
      const rowspan = num(attr(tc, 'number-rows-spanned'), 1);
      let inner = '';
      for (const kid of children(tc)) inner += await blockHtml(kid, zip, cache, depth + 1);
      const attrs = (colspan > 1 ? ` colspan="${colspan}"` : '') + (rowspan > 1 ? ` rowspan="${rowspan}"` : '');
      for (let i = 0; i < repeat; i++) cells.push(`<td${attrs}>${inner || '&nbsp;'}</td>`);
    }
    // Мөрийн төгсгөл дэх хоосон нүднүүдийг тайрна (ODS нь 1024 багана бичдэг)
    while (cells.length && cells[cells.length - 1] === '<td>&nbsp;</td>') cells.pop();
    if (!cells.length) continue;
    for (let i = 0; i < repeatRow; i++) rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return rows.length ? `<table class="doc-datatable"><tbody>${rows.join('')}</tbody></table>` : '';
}

export async function odfToHtml(buffer, ext) {
  const zip = await JSZip.loadAsync(buffer);
  const content = await readXml(zip, 'content.xml');
  if (!content) throw new Error('content.xml олдсонгүй — OpenDocument файл биш байна.');
  const cache = new Map();
  const warnings = [];
  const body = findAll(content, 'body')[0];
  if (!body) return { html: '', warnings: ['Агуулга олдсонгүй.'] };

  const parts = [];

  const text = child(body, 'text');
  const spreadsheet = child(body, 'spreadsheet');
  const presentation = child(body, 'presentation');

  if (spreadsheet) {
    for (const table of children(spreadsheet, 'table')) {
      const name = attr(table, 'name') || '';
      const html = await tableHtml(table, zip, cache);
      if (!html) continue;
      parts.push(`<h2 class="xl-sheet-title">${escapeHtml(name)}</h2>${html}`);
    }
    warnings.push('ODS хүснэгтийг оруулав. Зураг/диаграмын байрлал бүрэн хадгалагдахгүй байж болно.');
  } else if (presentation) {
    let n = 0;
    for (const page of children(presentation, 'page')) {
      n++;
      let inner = '';
      for (const frame of findAll(page, 'frame')) {
        const src = await imageFor(zip, frame, cache);
        if (src) {
          inner += `<figure><img src="${src}" style="max-width:100%"/></figure>`;
          continue;
        }
        const box = findAll(frame, 'text-box')[0];
        if (box) for (const kid of children(box)) inner += await blockHtml(kid, zip, cache);
      }
      parts.push(`<section class="pptx-slide"><div class="pptx-slide-no">Слайд ${n}</div>${inner || '<p><em>(хоосон)</em></p>'}</section>`);
    }
    warnings.push(`${n} слайдыг урсгал баримт болгож оруулав.`);
  } else if (text) {
    for (const kid of children(text)) parts.push(await blockHtml(kid, zip, cache));
  } else {
    warnings.push('Танигдсан агуулга олдсонгүй.');
  }

  return { html: parts.filter(Boolean).join(''), warnings };
}

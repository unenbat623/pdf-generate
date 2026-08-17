// PowerPoint (.pptx) → HTML. Слайд бүрийг нэг хэсэг болгож, текст, хүснэгт, зургийг
// байрлалын дарааллаар (дээрээс доош, зүүнээс баруун) урсгал хэлбэрээр гаргана.
import JSZip from 'jszip';
import { child, children, findAll, attr, num, textOf } from './xml.js';
import { readRels, readXml, imageDataUri, emuToPx, escapeHtml } from './opc.js';

function shapeOffset(node) {
  const off = findAll(node, 'off')[0];
  const ext = findAll(node, 'ext')[0];
  return {
    x: off ? num(attr(off, 'x'), 0) : 0,
    y: off ? num(attr(off, 'y'), 0) : 0,
    cx: ext ? num(attr(ext, 'cx'), 0) : 0,
    cy: ext ? num(attr(ext, 'cy'), 0) : 0,
  };
}

function runHtml(run) {
  const text = textOf(child(run, 't'));
  if (!text) return '';
  const props = child(run, 'rPr');
  let html = escapeHtml(text);
  if (props) {
    if (attr(props, 'b') === '1') html = `<strong>${html}</strong>`;
    if (attr(props, 'i') === '1') html = `<em>${html}</em>`;
    if (attr(props, 'u') && attr(props, 'u') !== 'none') html = `<u>${html}</u>`;
  }
  return html;
}

function paragraphHtml(p) {
  let html = '';
  for (const node of children(p)) {
    if (node.local === 'r') html += runHtml(node);
    else if (node.local === 'br') html += '<br/>';
    else if (node.local === 'fld') html += escapeHtml(textOf(child(node, 't')));
  }
  return html;
}

function textBodyBlocks(txBody) {
  const blocks = [];
  for (const p of children(txBody, 'p')) {
    const props = child(p, 'pPr');
    const level = props ? num(attr(props, 'lvl'), 0) : 0;
    const bulleted = props ? !child(props, 'buNone') : false;
    const html = paragraphHtml(p);
    blocks.push({ html, level, bulleted });
  }
  return blocks;
}

function blocksToHtml(blocks) {
  const out = [];
  let inList = false;
  for (const b of blocks) {
    if (!b.html.trim()) continue;
    if (b.bulleted) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li${b.level ? ` style="margin-left:${b.level * 16}px"` : ''}>${b.html}</li>`);
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<p>${b.html}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function tableHtml(tbl) {
  const grid = child(tbl, 'tblGrid');
  const widths = children(grid, 'gridCol').map((g) => emuToPx(attr(g, 'w')));
  const rows = [];
  for (const tr of children(tbl, 'tr')) {
    const cells = [];
    for (const tc of children(tr, 'tc')) {
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') continue;
      const span = num(attr(tc, 'gridSpan'), 1);
      const rowSpan = num(attr(tc, 'rowSpan'), 1);
      const body = child(tc, 'txBody');
      const inner = body ? blocksToHtml(textBodyBlocks(body)) : '';
      cells.push(
        `<td${span > 1 ? ` colspan="${span}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''}>${inner || '&nbsp;'}</td>`
      );
    }
    if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`);
  }
  if (!rows.length) return '';
  const colgroup = widths.length ? '<colgroup>' + widths.map((w) => `<col style="width:${w}px"/>`).join('') + '</colgroup>' : '';
  return `<table class="doc-datatable">${colgroup}<tbody>${rows.join('')}</tbody></table>`;
}

// Слайд доторх бүх бүтцийг цуглуулж, дэлгэц дээрх байрлалаар эрэмбэлнэ
async function collect(node, zip, rels, cache, items, depth = 0) {
  if (depth > 12) return;
  for (const kid of children(node)) {
    if (kid.local === 'sp') {
      const body = child(kid, 'txBody');
      const pos = shapeOffset(child(kid, 'spPr'));
      const nv = findAll(kid, 'nvSpPr')[0];
      const ph = nv ? findAll(nv, 'ph')[0] : null;
      const isTitle = ph ? /title|ctrTitle/i.test(attr(ph, 'type') || '') : false;
      if (body) items.push({ kind: 'text', pos, isTitle, blocks: textBodyBlocks(body) });
    } else if (kid.local === 'pic') {
      const blip = findAll(kid, 'blip')[0];
      const rel = blip ? rels[attr(blip, 'embed')] : null;
      const pos = shapeOffset(child(kid, 'spPr'));
      const src = rel && !rel.external ? await imageDataUri(zip, rel.target, cache) : null;
      if (src) items.push({ kind: 'image', pos, src });
    } else if (kid.local === 'graphicFrame') {
      const tbl = findAll(kid, 'tbl')[0];
      const pos = shapeOffset(kid);
      if (tbl) items.push({ kind: 'table', pos, html: tableHtml(tbl) });
    } else if (kid.local === 'grpSp') {
      await collect(kid, zip, rels, cache, items, depth + 1);
    }
  }
}

export async function pptxToHtml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const warnings = [];

  // Слайдын дарааллыг presentation.xml-ээс авна
  const presRels = await readRels(zip, 'ppt/presentation.xml');
  const pres = await readXml(zip, 'ppt/presentation.xml');
  let slidePaths = [];
  if (pres) {
    const list = findAll(pres, 'sldIdLst')[0];
    for (const s of children(list, 'sldId')) {
      const rel = presRels[attr(s, 'id')];
      if (rel && !rel.external) slidePaths.push(rel.target);
    }
  }
  if (!slidePaths.length) {
    slidePaths = zip
      .file(/^ppt\/slides\/slide\d+\.xml$/)
      .map((f) => f.name)
      .sort((a, b) => num(a.match(/(\d+)\.xml$/)?.[1]) - num(b.match(/(\d+)\.xml$/)?.[1]));
  }
  if (!slidePaths.length) return { html: '', warnings: ['Слайд олдсонгүй.'] };

  const cache = new Map();
  const parts = [];
  let slideNo = 0;

  for (const path of slidePaths) {
    const xml = await readXml(zip, path);
    if (!xml) continue;
    slideNo++;
    const rels = await readRels(zip, path);
    const tree = findAll(xml, 'spTree')[0];
    const items = [];
    if (tree) await collect(tree, zip, rels, cache, items);
    items.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);

    const body = [];
    let titled = false;
    for (const item of items) {
      if (item.kind === 'text') {
        if (item.isTitle && !titled) {
          const text = item.blocks.map((b) => b.html).join(' ').trim();
          if (text) {
            body.push(`<h2 class="pptx-title">${text}</h2>`);
            titled = true;
            continue;
          }
        }
        body.push(blocksToHtml(item.blocks));
      } else if (item.kind === 'image') {
        const w = emuToPx(item.pos.cx);
        body.push(`<figure><img src="${item.src}" style="${w ? `width:${w}px; ` : ''}max-width:100%"/></figure>`);
      } else if (item.kind === 'table' && item.html) {
        body.push(item.html);
      }
    }

    // Илтгэгчийн тэмдэглэл
    const notesRel = Object.values(rels).find((r) => /notesSlide$/.test(r.type));
    if (notesRel) {
      const notes = await readXml(zip, notesRel.target);
      const text = notes ? textOf(findAll(notes, 'spTree')[0]).trim() : '';
      if (text && text.length > 3) body.push(`<div class="pptx-notes"><em>Тэмдэглэл:</em> ${escapeHtml(text)}</div>`);
    }

    parts.push(
      `<section class="pptx-slide"><div class="pptx-slide-no">Слайд ${slideNo}</div>${body.join('') || '<p><em>(хоосон слайд)</em></p>'}</section>`
    );
  }

  warnings.push(`${parts.length} слайдыг урсгал баримт болгож оруулав (текст, хүснэгт, зураг). Слайдын нарийн байрлал биш, дарааллаар нь байрлуулсан.`);
  return { html: parts.join('<hr class="page-break"/>'), warnings };
}

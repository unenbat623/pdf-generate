// xl/styles.xml + xl/theme/theme1.xml → CSS. Өнгө (rgb/theme/tint/indexed), фонт, дүүргэлт, хүрээ, байрлуулалт.
import { parseXml, child, children, findAll, attr, num } from './xml.js';

// Excel-ийн уламжлалт 64 индексэт өнгө
const INDEXED = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080',
  '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
  '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF',
  '#00CCFF', '#CCFFFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99',
  '#3366FF', '#33CCCC', '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696',
  '#003366', '#339966', '#003300', '#333300', '#993300', '#993366', '#333399', '#333333',
];

// theme="N" индекс → clrScheme доторх нэр (Excel нь dk1/lt1-ийг сольж индекслэдэг)
const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

const DEFAULT_THEME = ['#FFFFFF', '#000000', '#EEECE1', '#1F497D', '#4F81BD', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646', '#0000FF', '#800080'];

function argbToCss(argb = '') {
  const hex = String(argb).replace(/[^0-9a-f]/gi, '');
  if (hex.length === 8) return '#' + hex.slice(2).toUpperCase();
  if (hex.length === 6) return '#' + hex.toUpperCase();
  return null;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return ('#' + c(r) + c(g) + c(b)).toUpperCase();
}

// OOXML tint: сөрөг бол бараан, эерэг бол цайвар (HSL гэрэлтэлт дээр)
function applyTint(hex, tint) {
  if (!tint) return hex;
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l2 = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const c = (1 - Math.abs(2 * l2 - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l2 - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return rgbToHex(seg.map((v) => (v + m) * 255));
}

export function readTheme(themeXml) {
  if (!themeXml) return DEFAULT_THEME.slice();
  const scheme = findAll(parseXml(themeXml), 'clrScheme')[0];
  if (!scheme) return DEFAULT_THEME.slice();
  const byName = {};
  for (const entry of children(scheme)) {
    const srgb = child(entry, 'srgbClr');
    const sys = child(entry, 'sysClr');
    const hex = srgb ? argbToCss(attr(srgb, 'val')) : sys ? argbToCss(attr(sys, 'lastClr') || (attr(sys, 'val') === 'window' ? 'FFFFFF' : '000000')) : null;
    if (hex) byName[entry.local] = hex;
  }
  return THEME_ORDER.map((name, i) => byName[name] || DEFAULT_THEME[i]);
}

function colorOf(node, theme) {
  if (!node) return null;
  if (attr(node, 'auto') === '1') return null;
  const rgb = attr(node, 'rgb');
  if (rgb) return argbToCss(rgb);
  const themeIdx = attr(node, 'theme');
  if (themeIdx !== undefined) {
    const base = theme[Number(themeIdx)] || null;
    return base ? applyTint(base, num(attr(node, 'tint'), 0)) : null;
  }
  const indexed = attr(node, 'indexed');
  if (indexed !== undefined) return INDEXED[Number(indexed)] || null;
  return null;
}

const BORDER_CSS = {
  thin: '1px solid',
  hair: '1px solid',
  dotted: '1px dotted',
  dashed: '1px dashed',
  dashDot: '1px dashed',
  dashDotDot: '1px dotted',
  medium: '2px solid',
  mediumDashed: '2px dashed',
  mediumDashDot: '2px dashed',
  mediumDashDotDot: '2px dotted',
  slantDashDot: '2px dashed',
  thick: '3px solid',
  double: '3px double',
};

// Excel-ийн баганын өргөн нь Windows фонтын метрикээр тооцогддог. Тэр фонтууд
// сервер/Linux дээр байхгүй тул хэмжээ ижилхэн (metric-compatible) орлуулагчийг
// ард нь тавина — эс тэгвэл текст багананд багтахгүй тасарна.
const METRIC_SUBSTITUTES = {
  calibri: "'Carlito'",
  cambria: "'Caladea'",
  arial: "'Liberation Sans', 'Arimo', Helvetica",
  helvetica: "'Liberation Sans', 'Arimo'",
  'times new roman': "'Liberation Serif', 'Tinos'",
  'courier new': "'Liberation Mono', 'Cousine'",
  georgia: "'Gelasio'",
  verdana: "'DejaVu Sans'",
  tahoma: "'DejaVu Sans'",
};

function fontStack(name) {
  const clean = name.replace(/['"]/g, '').trim();
  const sub = METRIC_SUBSTITUTES[clean.toLowerCase()];
  return [`'${clean}'`, sub, "'Noto Sans'", "'Noto Sans CJK JP'", 'sans-serif'].filter(Boolean).join(', ');
}

const H_ALIGN = { left: 'left', center: 'center', centerContinuous: 'center', right: 'right', justify: 'justify', distributed: 'justify', fill: 'left' };
const V_ALIGN = { top: 'top', center: 'middle', bottom: 'bottom', justify: 'middle', distributed: 'middle' };

/**
 * styles.xml-ийг уншиж cellXfs индекс → CSS хөрвүүлэгч буцаана.
 * `cssFor(xfIndex, { isNumber })` → { css, wrap }
 */
export function buildStyleTable(stylesXml, themeXml) {
  const theme = readTheme(themeXml);
  const empty = { css: '', wrap: false, font: null };
  if (!stylesXml) return { cssFor: () => empty, theme };

  const root = parseXml(stylesXml);
  const sheetNode = findAll(root, 'styleSheet')[0] || root;

  const fonts = children(child(sheetNode, 'fonts'), 'font').map((f) => ({
    bold: !!child(f, 'b') && attr(child(f, 'b'), 'val') !== '0',
    italic: !!child(f, 'i') && attr(child(f, 'i'), 'val') !== '0',
    underline: !!child(f, 'u') && attr(child(f, 'u'), 'val') !== 'none',
    strike: !!child(f, 'strike') && attr(child(f, 'strike'), 'val') !== '0',
    size: num(attr(child(f, 'sz'), 'val'), 11),
    name: attr(child(f, 'name'), 'val') || '',
    color: colorOf(child(f, 'color'), theme),
    vertAlign: attr(child(f, 'vertAlign'), 'val') || '',
  }));

  const fills = children(child(sheetNode, 'fills'), 'fill').map((f) => {
    const pattern = child(f, 'patternFill');
    const gradient = child(f, 'gradientFill');
    if (gradient) return colorOf(child(children(gradient, 'stop')[0], 'color'), theme);
    if (!pattern) return null;
    const type = attr(pattern, 'patternType') || 'none';
    if (type === 'none') return null;
    const fg = colorOf(child(pattern, 'fgColor'), theme);
    const bg = colorOf(child(pattern, 'bgColor'), theme);
    // Бүтэн дүүргэлтэд fgColor нь дэвсгэр; бусад хээнд ойролцоолж fg-г авна
    return fg || bg;
  });

  const borders = children(child(sheetNode, 'borders'), 'border').map((b) => {
    const side = (name) => {
      const node = child(b, name);
      const style = node && attr(node, 'style');
      if (!style || style === 'none') return null;
      const color = colorOf(child(node, 'color'), theme) || '#000000';
      return `${BORDER_CSS[style] || '1px solid'} ${color}`;
    };
    return { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
  });

  const xfs = children(child(sheetNode, 'cellXfs'), 'xf').map((xf) => {
    const alignment = child(xf, 'alignment');
    return {
      fontId: num(attr(xf, 'fontId'), 0),
      fillId: num(attr(xf, 'fillId'), 0),
      borderId: num(attr(xf, 'borderId'), 0),
      applyFont: attr(xf, 'applyFont') !== '0',
      applyFill: attr(xf, 'applyFill') !== '0',
      applyBorder: attr(xf, 'applyBorder') !== '0',
      horizontal: alignment ? attr(alignment, 'horizontal') : undefined,
      vertical: alignment ? attr(alignment, 'vertical') : undefined,
      wrapText: alignment ? attr(alignment, 'wrapText') === '1' : false,
      indent: alignment ? num(attr(alignment, 'indent'), 0) : 0,
      rotation: alignment ? num(attr(alignment, 'textRotation'), 0) : 0,
    };
  });

  const baseFont = fonts[0] || { size: 11, name: 'Calibri' };
  const cache = new Map();

  function cssFor(index, { isNumber = false } = {}) {
    const key = `${index}|${isNumber ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const xf = xfs[index];
    if (!xf) {
      const fallback = { css: isNumber ? 'text-align: right' : '', wrap: false, font: baseFont };
      cache.set(key, fallback);
      return fallback;
    }
    const decl = [];
    const font = fonts[xf.fontId] || baseFont;
    if (xf.applyFont && font) {
      if (font.bold) decl.push('font-weight: 700');
      if (font.italic) decl.push('font-style: italic');
      const deco = [font.underline ? 'underline' : '', font.strike ? 'line-through' : ''].filter(Boolean);
      if (deco.length) decl.push(`text-decoration: ${deco.join(' ')}`);
      if (font.size && Math.abs(font.size - baseFont.size) > 0.01) decl.push(`font-size: ${Math.round(font.size * 100) / 100}pt`);
      if (font.color && font.color !== '#000000') decl.push(`color: ${font.color}`);
      // style="..." дотор давхар хашилт хэрэглэвэл атрибут тасарна — ганц хашилт заавал
      if (font.name) decl.push(`font-family: ${fontStack(font.name)}`);
      if (font.vertAlign === 'superscript') decl.push('vertical-align: super');
      else if (font.vertAlign === 'subscript') decl.push('vertical-align: sub');
    }
    if (xf.applyFill) {
      const fill = fills[xf.fillId];
      if (fill) decl.push(`background-color: ${fill}`);
    }
    if (xf.applyBorder) {
      const border = borders[xf.borderId];
      if (border) {
        for (const side of ['top', 'right', 'bottom', 'left']) {
          if (border[side]) decl.push(`border-${side}: ${border[side]}`);
        }
      }
    }
    const halign = H_ALIGN[xf.horizontal] || (isNumber ? 'right' : '');
    if (halign) decl.push(`text-align: ${halign}`);
    const valign = V_ALIGN[xf.vertical] || 'bottom';
    decl.push(`vertical-align: ${valign}`);
    if (xf.indent) decl.push(`padding-left: ${4 + xf.indent * 9}px`);
    if (xf.rotation === 255) decl.push('writing-mode: vertical-rl');

    const out = { css: decl.join('; '), wrap: xf.wrapText, font };
    cache.set(key, out);
    return out;
  }

  return { cssFor, theme, baseFont };
}

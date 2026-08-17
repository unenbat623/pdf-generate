// Хамааралгүй, жижигхэн XML уншигч — OOXML (docx/xlsx/pptx) болон ODF-д зориулав.
// Зөвхөн машинаас үүссэн, зөв бүтэцтэй XML-ийг уншина (DTD/entity тэлэлт дэмжихгүй).

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeXml(text = '') {
  return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return NAMED[ent] ?? m;
  });
}

const ATTR_RE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(raw) {
  const attrs = {};
  if (!raw) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw))) attrs[m[1]] = decodeXml(m[2] ?? m[3] ?? '');
  return attrs;
}

export const TEXT_NODE = '#text';

function makeNode(name, attrs) {
  const colon = name.indexOf(':');
  return {
    name,
    local: colon === -1 ? name : name.slice(colon + 1), // namespace prefix-гүй нэр
    attrs,
    children: [],
    text: '',
  };
}

// Текстийг ЗАНГИЛАА болгон дараалалд нь хадгална — эс тэгвэл
// "Энэ бол <span>догол мөр</span> юм." гэх мэт холимог агуулга эмх замбараагүй болно.
function addText(parent, value) {
  if (!value) return;
  parent.text += value;
  const last = parent.children[parent.children.length - 1];
  if (last && last.local === TEXT_NODE) last.text += value;
  else parent.children.push({ name: TEXT_NODE, local: TEXT_NODE, attrs: {}, children: [], text: value });
}

// Attribute доторх ">" тэмдгийг алгасаж, tag-ийн төгсгөлийг олно.
function tagEnd(xml, start) {
  let quote = 0;
  for (let i = start + 1; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === String.fromCharCode(quote)) quote = 0;
    } else if (ch === '"' || ch === "'") {
      quote = ch.charCodeAt(0);
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

/** XML текстийг мод болгож уншина. Үндэс нь `#root`, жинхэнэ баримт нь `root.children[0]`. */
export function parseXml(xml = '') {
  const root = makeNode('#root', {});
  const stack = [root];
  const n = xml.length;
  let i = 0;

  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      addText(stack[stack.length - 1], decodeXml(xml.slice(i)));
      break;
    }
    if (lt > i) addText(stack[stack.length - 1], decodeXml(xml.slice(i, lt)));

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      addText(stack[stack.length - 1], xml.slice(lt + 9, end === -1 ? n : end));
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const gt = tagEnd(xml, lt);
    if (gt === -1) break;
    const inner = xml.slice(lt + 1, gt);

    if (inner[0] === '/') {
      const name = inner.slice(1).trim();
      // Тохирох нээлттэй tag руу буцаж хаана (буруу үүрлэлтээс хамгаална)
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const sp = body.search(/[\s/]/);
    const name = (sp === -1 ? body : body.slice(0, sp)).trim();
    const node = makeNode(name, parseAttrs(sp === -1 ? '' : body.slice(sp)));
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  return root;
}

/** Шууд хүүхдүүдээс local нэрээр хайна. */
export function child(node, local) {
  if (!node) return null;
  return node.children.find((c) => c.local === local) || null;
}

/** Шууд хүүхэд ЭЛЕМЕНТүүд (текст зангилаа орохгүй). */
export function children(node, local) {
  if (!node) return [];
  return local ? node.children.filter((c) => c.local === local) : node.children.filter((c) => c.local !== TEXT_NODE);
}

/** Текст зангилаа ОРУУЛААД, эх дараалалаараа бүх хүүхэд. */
export function childNodes(node) {
  return node ? node.children : [];
}

/** `a/b/c` замаар (local нэрээр) эхний тохирлыг олно. */
export function pick(node, path) {
  let cur = node;
  for (const part of path.split('/')) {
    cur = child(cur, part);
    if (!cur) return null;
  }
  return cur;
}

/** Модны бүх гүнээс local нэрээр хайна. */
export function findAll(node, local, out = []) {
  if (!node) return out;
  for (const c of node.children) {
    if (c.local === TEXT_NODE) continue;
    if (c.local === local) out.push(c);
    findAll(c, local, out);
  }
  return out;
}

/** Бүх үр удмын текстийг эх дараалалаар нь залгана. */
export function textOf(node) {
  if (!node) return '';
  if (node.local === TEXT_NODE) return node.text;
  let out = '';
  for (const c of node.children) out += textOf(c);
  return out;
}

export function attr(node, name) {
  if (!node) return undefined;
  if (node.attrs[name] !== undefined) return node.attrs[name];
  // namespace prefix-ийг үл хайхран тааруулна (r:id ↔ id)
  const key = Object.keys(node.attrs).find((k) => k.slice(k.indexOf(':') + 1) === name);
  return key ? node.attrs[key] : undefined;
}

export function num(value, fallback = 0) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

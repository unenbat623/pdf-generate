import { parse } from 'node-html-parser';

const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'small',
  'span',
  'strong',
  'style',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

const GLOBAL_ATTRS = new Set([
  'align',
  'class',
  'colspan',
  'data-page',
  'height',
  'rowspan',
  'style',
  'title',
  'width',
]);

const TAG_ATTRS = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt']),
  ol: new Set(['start', 'type']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
};

const URL_ATTRS = new Set(['href', 'src']);
const SAFE_CSS_PROPS = new Set([
  'align-items',
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-collapse',
  'border-color',
  'border-left',
  'border-radius',
  'border-right',
  'border-spacing',
  'border-style',
  'border-top',
  'border-width',
  'bottom',
  'box-sizing',
  'break-after',
  'break-before',
  'break-inside',
  'clear',
  'color',
  'display',
  'flex',
  'flex-direction',
  'flex-wrap',
  'float',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'gap',
  'height',
  'justify-content',
  'left',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-type',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'object-fit',
  'opacity',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'page-break-after',
  'page-break-before',
  'page-break-inside',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'position',
  'right',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'top',
  'transform',
  'transform-origin',
  'vertical-align',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
  'writing-mode',
  'z-index',
]);

function isSafeUrl(value, tagName, attrName) {
  const url = String(value || '').trim();
  if (!url) return false;
  if (tagName === 'img' && attrName === 'src') {
    return /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(url);
  }
  return /^(https?:|mailto:|tel:|#|\/(?!\/))/i.test(url);
}

function sanitizeStyle(style = '') {
  const declarations = [];
  for (const rawDecl of style.split(';')) {
    const idx = rawDecl.indexOf(':');
    if (idx === -1) continue;
    const prop = rawDecl.slice(0, idx).trim().toLowerCase();
    const value = rawDecl.slice(idx + 1).trim();
    if (!SAFE_CSS_PROPS.has(prop)) continue;
    if (/expression\s*\(|javascript:|url\s*\(/i.test(value)) continue;
    declarations.push(`${prop}: ${value}`);
  }
  return declarations.join('; ');
}

function sanitizeCssBlock(css = '') {
  return String(css)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]+;/gi, '')
    .replace(/[^{}]+{[^{}]*}/g, (rule) => {
      if (/javascript:|expression\s*\(|url\s*\(|behavior\s*:|-moz-binding/i.test(rule)) return '';
      return rule;
    })
    .trim();
}

function sanitizeElement(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType !== 1) continue;
    const tagName = child.tagName.toLowerCase();
    if (['script', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math'].includes(tagName)) {
      child.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tagName)) {
      child.replaceWith(...child.childNodes);
      continue;
    }

    if (tagName === 'style') {
      const cleanCss = sanitizeCssBlock(child.textContent || '');
      if (cleanCss) child.set_content(cleanCss);
      else child.remove();
      continue;
    }

    for (const [name, value] of Object.entries(child.attributes)) {
      const attr = name.toLowerCase();
      const allowed = GLOBAL_ATTRS.has(attr) || TAG_ATTRS[tagName]?.has(attr);
      if (!allowed || attr.startsWith('on')) {
        child.removeAttribute(name);
        continue;
      }
      if (URL_ATTRS.has(attr) && !isSafeUrl(value, tagName, attr)) {
        child.removeAttribute(name);
        continue;
      }
      if (attr === 'style') {
        const clean = sanitizeStyle(value);
        if (clean) child.setAttribute('style', clean);
        else child.removeAttribute(name);
      }
    }

    if (tagName === 'a') {
      child.setAttribute('rel', 'noopener noreferrer');
      if (child.getAttribute('target') && child.getAttribute('target') !== '_blank') {
        child.removeAttribute('target');
      }
    }
    sanitizeElement(child);
  }
}

export function sanitizeHtml(html = '') {
  const root = parse(`<div id="sanitize-root">${html}</div>`, {
    blockTextElements: { script: false, noscript: false, style: true, pre: true },
    comment: false,
  });
  const wrapper = root.querySelector('#sanitize-root');
  sanitizeElement(wrapper);
  return wrapper.innerHTML;
}

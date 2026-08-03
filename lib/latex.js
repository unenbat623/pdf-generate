// HTML (editor) -> LaTeX -> PDF (tectonic).
// Албан бичгийн стандарт хэлбэр: A4, MNS 5140-ийн ойролцоо захын зай, хэлээр нь фонт.
import { parse } from 'node-html-parser';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);
// tectonic-ийн зам: env-ээс (Docker), эсвэл локал macOS-ийн ~/.local/bin
const TECTONIC = process.env.TECTONIC_BIN || path.join(os.homedir(), '.local/bin/tectonic');
// Фонт: env-ээр дарж болно (Docker/Linux дээр Noto ашиглана)
const FONT_LATIN = process.env.FONT_LATIN || 'Times New Roman';
const FONT_JA = process.env.FONT_JA || 'Hiragino Mincho ProN';

// ---------- LaTeX escape ----------
function esc(s = '') {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u00A0/g, '~');
}

// ---------- HTML node -> LaTeX ----------
function childrenToLatex(node, ctx) {
  let out = '';
  for (const child of node.childNodes) out += nodeToLatex(child, ctx);
  return out;
}

function saveImage(src, ctx) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(src);
  if (!m) return null;
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
  const file = `img${ctx.imgCount++}.${ext || 'png'}`;
  ctx.images.push({ file, data: Buffer.from(m[2], 'base64') });
  return file;
}

function nodeToLatex(node, ctx) {
  // Текст node
  if (node.nodeType === 3) return esc(node.rawText ? decodeEntities(node.rawText) : node.text || '');

  const tag = (node.rawTagName || '').toLowerCase();
  const inner = () => childrenToLatex(node, ctx);

  switch (tag) {
    case 'h1':
      return `\n\n{\\centering\\LARGE\\bfseries ${inner()}\\par}\\vspace{6pt}\n\n`;
    case 'h2':
      return `\n\n{\\Large\\bfseries ${inner()}}\\par\\vspace{4pt}\n\n`;
    case 'h3':
      return `\n\n{\\large\\bfseries ${inner()}}\\par\\vspace{3pt}\n\n`;
    case 'p':
    case 'div': {
      const align = alignOf(node);
      const body = inner().trim();
      if (!body) return '\\vspace{6pt}\n';
      if (align === 'center') return `\n\n{\\centering ${body}\\par}\n\n`;
      if (align === 'right') return `\n\n{\\raggedleft ${body}\\par}\n\n`;
      return `\n\n${body}\\par\n\n`;
    }
    case 'strong':
    case 'b':
      return `\\textbf{${inner()}}`;
    case 'em':
    case 'i':
      return `\\textit{${inner()}}`;
    case 'u':
      return `\\underline{${inner()}}`;
    case 'br':
      return `\\\\\n`;
    case 'hr':
      return `\n\\vspace{4pt}\\hrule\\vspace{6pt}\n`;
    case 'ul':
      return `\n\\begin{itemize}\n${listItems(node, ctx)}\\end{itemize}\n`;
    case 'ol':
      return `\n\\begin{enumerate}\n${listItems(node, ctx)}\\end{enumerate}\n`;
    case 'li':
      return `\\item ${inner()}\n`;
    case 'figure':
      return `\n\n{\\centering ${inner()}\\par}\n\n`;
    case 'figcaption':
      return `\\\\{\\small\\itshape ${inner()}}`;
    case 'img': {
      const src = node.getAttribute('src') || '';
      const file = saveImage(src, ctx);
      if (!file) return '';
      return `\\includegraphics[max width=\\linewidth,max height=0.4\\textheight]{${file}}`;
    }
    case 'table':
      return tableToLatex(node, ctx);
    case 'tr':
    case 'td':
    case 'th':
    case 'thead':
    case 'tbody':
      return inner(); // table нь өөрөө зохицуулна
    case 'span':
    case 'a':
    default:
      return inner();
  }
}

function alignOf(node) {
  const style = (node.getAttribute && node.getAttribute('style')) || '';
  const m = /text-align\s*:\s*(left|center|right)/i.exec(style);
  return m ? m[1].toLowerCase() : null;
}

function listItems(node, ctx) {
  let out = '';
  for (const li of node.childNodes) {
    if ((li.rawTagName || '').toLowerCase() === 'li') out += `\\item ${childrenToLatex(li, ctx)}\n`;
  }
  return out;
}

// ---------- Table ----------
function tableToLatex(node, ctx) {
  const rows = node.querySelectorAll('tr');
  if (!rows.length) return '';
  const maxCols = Math.max(...rows.map((r) => r.querySelectorAll('td,th').length));
  if (!maxCols) return '';
  const colSpec = '|' + Array(maxCols).fill('l').join('|') + '|';
  let body = '';
  for (const r of rows) {
    const cells = r.querySelectorAll('td,th');
    const parts = [];
    for (let i = 0; i < maxCols; i++) {
      parts.push(cells[i] ? childrenToLatex(cells[i], ctx).trim() : '');
    }
    body += parts.join(' & ') + ' \\\\ \\hline\n';
  }
  return `\n\\begin{center}\n\\begin{tabular}{${colSpec}}\n\\hline\n${body}\\end{tabular}\n\\end{center}\n`;
}

// минимал HTML entity decode
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------- Full .tex ----------
function fontFor(lang) {
  // ja: япон Mincho serif (албан бичгийн стандарт), бусад: Latin+Кирилл serif
  const main = lang === 'ja' ? FONT_JA : FONT_LATIN;
  return `\\usepackage{fontspec}
\\setmainfont{${main}}`;
}

function buildTex(bodyLatex, lang) {
  return `\\documentclass[12pt,a4paper]{article}
${fontFor(lang)}
\\usepackage[a4paper,top=20mm,bottom=20mm,left=30mm,right=15mm]{geometry}
\\usepackage{graphicx}
\\usepackage[export]{adjustbox}
\\usepackage{array}
\\usepackage{fancyhdr}
\\usepackage{setspace}
\\usepackage{parskip}
\\usepackage{ragged2e}
\\setlength{\\parindent}{0pt}
\\onehalfspacing
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\cfoot{\\small\\thepage}
\\begin{document}
${bodyLatex}
\\end{document}
`;
}

// ---------- Render ----------
export async function htmlToPdf(html, lang = 'src') {
  const root = parse(html || '<p></p>', { comment: false });
  const ctx = { images: [], imgCount: 0 };
  const body = childrenToLatex(root, ctx);
  const tex = buildTex(body, lang);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'barimt-tex-'));
  try {
    await fs.writeFile(path.join(dir, 'doc.tex'), tex, 'utf8');
    for (const img of ctx.images) await fs.writeFile(path.join(dir, img.file), img.data);

    await execFileP(TECTONIC, ['--outdir', dir, '--keep-logs', path.join(dir, 'doc.tex')], {
      cwd: dir,
      timeout: 120000,
      env: { ...process.env, PATH: `${path.join(os.homedir(), '.local/bin')}:${process.env.PATH}` },
    });
    const pdf = await fs.readFile(path.join(dir, 'doc.pdf'));
    return pdf;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

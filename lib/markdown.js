// Жижигхэн Markdown → HTML (гарчиг, жагсаалт, хүснэгт, код, ишлэл, холбоос, зураг).
import { escapeHtml } from './opc.js';

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/!\[([^\]]*)\]\((data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)\)/gi, '<img alt="$1" src="$2"/>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return out;
}

function tableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function markdownToHtml(md = '') {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let listType = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      closeList();
      const block = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) block.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(block.join('\n'))}</code></pre>`);
      continue;
    }

    // Хүснэгт: толгой мөр + |---|---| зураас
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]*-[\s|:-]*$/.test(lines[i + 1]) && /\|/.test(lines[i + 1])) {
      closeList();
      const head = tableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(tableRow(lines[i++]));
      out.push('<table class="doc-datatable"><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of rows) out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      out.push('</tbody></table>');
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      closeList();
      out.push('<hr/>');
      i++;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      i++;
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const want = bullet ? 'ul' : 'ol';
      if (listType !== want) {
        closeList();
        out.push(`<${want}>`);
        listType = want;
      }
      out.push(`<li>${inline((bullet || ordered)[1])}</li>`);
      i++;
      continue;
    }

    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    closeList();
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br/>')}</p>`);
  }
  closeList();
  return out.join('');
}

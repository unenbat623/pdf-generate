// Хуучин Word (.doc, Word 97-2003 binary) → HTML.
// FIB → Clx (piece table) → WordDocument урсгалаас текстийг зөв кодчлолоор гаргана.
// Тэмдэглэл: энэ формат дахь зураг (Escher/Data урсгал) орж ирэхгүй — .docx болгож хадгалахыг зөвлөнө.
import * as XLSX from 'xlsx';
import { escapeHtml } from './opc.js';

// CP1252-ийн 0x80–0x9F муж (шахагдсан хэсгүүдэд хэрэглэгдэнэ)
const CP1252_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

const C = (code) => String.fromCharCode(code);
const CH = {
  FIELD_BEGIN: C(0x13),
  FIELD_SEP: C(0x14),
  FIELD_END: C(0x15),
  CELL_END: C(0x07),
  LINE_BREAK: C(0x0b),
  PAGE_BREAK: C(0x0c),
  TAB: C(0x09),
};
// Утга агуулаагүй удирдах тэмдэгтүүд (талбар, зураг, тэмдэглэгээ)
const CONTROL_RE = /[\x00-\x06\x08\x0e-\x1f]/g;

function findStream(cfb, name) {
  const index = (cfb.FileIndex || []).findIndex((f) => f && f.name === name);
  if (index >= 0 && cfb.FileIndex[index].content) return Buffer.from(cfb.FileIndex[index].content);
  for (const path of [`/${name}`, name]) {
    const found = XLSX.CFB.find(cfb, path);
    if (found && found.content) return Buffer.from(found.content);
  }
  return null;
}

function decodePiece(buf, compressed) {
  if (!compressed) return buf.toString('utf16le');
  let out = '';
  for (const byte of buf) out += CP1252_HIGH[byte] || String.fromCharCode(byte);
  return out;
}

export function legacyDocToHtml(buffer) {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const doc = findStream(cfb, 'WordDocument');
  if (!doc || doc.length < 0x200) throw new Error('WordDocument урсгал олдсонгүй — .doc файл биш байж магадгүй.');
  if (doc.readUInt16LE(0) !== 0xa5ec) throw new Error('Word 97-2003 файлын гарын үсэг таарсангүй.');

  const flags = doc.readUInt16LE(0x0a);
  const tableName = flags & 0x0200 ? '1Table' : '0Table';
  const table = findStream(cfb, tableName) || findStream(cfb, '1Table') || findStream(cfb, '0Table');
  if (!table) throw new Error('Table урсгал олдсонгүй.');

  // FIB-ийн хувьсах урттай хэсгүүдийг алгасаж FibRgFcLcb97 руу хүрнэ
  const csw = doc.readUInt16LE(0x20);
  const cslwOff = 0x22 + csw * 2;
  const cslw = doc.readUInt16LE(cslwOff);
  const cbRgFcLcbOff = cslwOff + 2 + cslw * 4;
  const rgFcLcb = cbRgFcLcbOff + 2;
  if (rgFcLcb + 68 * 4 > doc.length) throw new Error('FIB бүтэц танигдсангүй.');
  const fcClx = doc.readUInt32LE(rgFcLcb + 66 * 4);
  const lcbClx = doc.readUInt32LE(rgFcLcb + 67 * 4);
  if (!lcbClx || fcClx + lcbClx > table.length) throw new Error('Piece table (Clx) уншигдсангүй.');

  const clx = table.subarray(fcClx, fcClx + lcbClx);

  // Clx = RgPrc* (0x01 …) дараа нь Pcdt (0x02)
  let p = 0;
  while (p < clx.length && clx[p] === 0x01) {
    p += 3 + clx.readUInt16LE(p + 1);
  }
  if (clx[p] !== 0x02) throw new Error('Pcdt хэсэг олдсонгүй.');
  const lcbPlcPcd = clx.readUInt32LE(p + 1);
  const plc = clx.subarray(p + 5, p + 5 + lcbPlcPcd);
  const pieceCount = Math.floor((plc.length - 4) / 12);
  if (pieceCount <= 0) throw new Error('Текстийн хэсэг олдсонгүй.');

  let text = '';
  for (let i = 0; i < pieceCount; i++) {
    const cpStart = plc.readUInt32LE(i * 4);
    const cpEnd = plc.readUInt32LE((i + 1) * 4);
    const pcd = plc.subarray((pieceCount + 1) * 4 + i * 8);
    const fc = pcd.readUInt32LE(2);
    const compressed = (fc & 0x40000000) !== 0;
    const offset = compressed ? (fc & 0x3fffffff) / 2 : fc & 0x3fffffff;
    const chars = cpEnd - cpStart;
    const bytes = compressed ? chars : chars * 2;
    if (chars <= 0 || offset < 0 || offset + bytes > doc.length) continue;
    text += decodePiece(doc.subarray(offset, offset + bytes), compressed);
  }

  // Талбарын заавар (0x13…0x14) болон үлдэгдэл техникийн тэмдэгтүүдийг цэвэрлэнэ
  const fieldInstruction = new RegExp(`${CH.FIELD_BEGIN}[^]*?${CH.FIELD_SEP}`, 'g');
  text = text.replace(fieldInstruction, '').replace(CONTROL_RE, '');

  // 0x0D = догол мөр, 0x07 = нүд/мөрийн төгсгөл, 0x0C = хуудас таслалт
  const paragraphs = text
    .split(new RegExp('[\\r' + CH.CELL_END + CH.PAGE_BREAK + ']'))
    .map((line) => line.split(CH.LINE_BREAK).join('\n').split(CH.TAB).join('\t').trim())
    .filter((line) => line.length);

  if (!paragraphs.length) throw new Error('Текст олдсонгүй.');

  const html = paragraphs
    .map((line) => `<p>${escapeHtml(line).replace(/\n/g, '<br/>').replace(/\t/g, ' &nbsp;·&nbsp; ')}</p>`)
    .join('');

  return {
    html,
    warnings: [
      'Хуучин .doc форматаас зөвхөн текст, догол мөрийг уншлаа — зураг, хүснэгтийн хүрээ, өнгө орж ирээгүй. Word дээр нээж «.docx» болгож хадгалбал бүрэн эх байдлаараа орно.',
    ],
  };
}

// Хуучин Word (.doc, Word 97-2003 binary) → HTML.
// FIB → Clx (piece table) → WordDocument урсгалаас текстийг зөв кодчлолоор гаргана.
// Тэмдэглэл: энэ формат дахь зураг (Escher/Data урсгал) орж ирэхгүй — .docx болгож хадгалахыг зөвлөнө.
import * as XLSX from 'xlsx';
import { escapeHtml } from './opc.js';

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

/**
 * Шахагдсан (8 бит) хэсгүүдийн кодчилолыг таана: өндөр байтуудын дийлэнх нь
 * 0xC0–0xFF мужид байвал Кирилл (CP1251 — Монгол/Орос), үгүй бол CP1252.
 * CP1252-оор уншвал Монгол текст «Áàéãóóëëàãà» мэт эвдэрдэг байсныг засна.
 */
function detectCodepage(pieces) {
  let high = 0;
  let cyrillic = 0;
  for (const piece of pieces) {
    if (!piece.compressed) continue;
    for (const byte of piece.buf) {
      if (byte < 0x80) continue;
      high++;
      if (byte >= 0xc0 || byte === 0xa8 || byte === 0xb8) cyrillic++;
    }
  }
  return high > 0 && cyrillic / high >= 0.5 ? 'windows-1251' : 'windows-1252';
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

  const pieces = [];
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
    pieces.push({ buf: doc.subarray(offset, offset + bytes), compressed });
  }

  const decoder = new TextDecoder(detectCodepage(pieces));
  let text = '';
  for (const piece of pieces) {
    text += piece.compressed ? decoder.decode(piece.buf) : piece.buf.toString('utf16le');
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

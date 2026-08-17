// OPC (zip суурьтай Office багц) туслахууд: relationship унших, зам шийдэх, медиа → data URI.
import { parseXml, findAll, attr } from './xml.js';

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
  svg: 'image/svg+xml',
};

// Браузер/PDF-д шууд харагдах форматууд (emf/wmf/tiff нь харагдахгүй тул алгасна)
export const RENDERABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp']);

export function mimeForPath(p = '') {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/** "xl/drawings/drawing1.xml" + "../media/image1.png" → "xl/media/image1.png" */
export function resolvePath(basePart, target) {
  if (!target) return '';
  if (/^[a-z]+:\/\//i.test(target)) return target;
  if (target.startsWith('/')) return target.slice(1);
  const baseDir = basePart.slice(0, basePart.lastIndexOf('/') + 1);
  const parts = (baseDir + target).split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Тухайн хэсгийн _rels файлыг уншиж { rId: { target, type, external } } буцаана. */
export async function readRels(zip, partPath) {
  const dir = partPath.slice(0, partPath.lastIndexOf('/') + 1);
  const base = partPath.slice(partPath.lastIndexOf('/') + 1);
  const relPath = `${dir}_rels/${base}.rels`;
  const file = zip.file(relPath);
  if (!file) return {};
  const root = parseXml(await file.async('string'));
  const map = {};
  for (const rel of findAll(root, 'Relationship')) {
    const id = attr(rel, 'Id');
    if (!id) continue;
    const target = attr(rel, 'Target') || '';
    const external = attr(rel, 'TargetMode') === 'External';
    map[id] = {
      type: attr(rel, 'Type') || '',
      external,
      target: external ? target : resolvePath(partPath, target),
    };
  }
  return map;
}

export async function readXml(zip, partPath) {
  const file = zip.file(partPath);
  if (!file) return null;
  return parseXml(await file.async('string'));
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // нэг зураг 6MB-аас том бол алгасна (хөтчийг гацаахгүй)

/** Zip доторх зургийг base64 data URI болгоно. Харагдахгүй/хэт том бол null. */
export async function imageDataUri(zip, partPath, cache = null) {
  if (cache && cache.has(partPath)) return cache.get(partPath);
  const file = zip.file(partPath);
  if (!file) return null;
  const mime = mimeForPath(partPath);
  if (!RENDERABLE.has(mime)) return null;
  const buf = await file.async('nodebuffer');
  const uri = buf.length > MAX_IMAGE_BYTES ? null : `data:${mime};base64,${buf.toString('base64')}`;
  if (cache) cache.set(partPath, uri);
  return uri;
}

export const EMU_PER_PX = 9525; // 914400 EMU/inch ÷ 96 px/inch

export function emuToPx(emu) {
  return Math.round((Number(emu) || 0) / EMU_PER_PX);
}

export const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

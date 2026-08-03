// LibreOffice headless-ээр Word/Excel-ийг ЭХ ХЭВЭЭР нь HTML болгоно (fidelity).
// Зургийг base64-оор шингээж, self-contained HTML буцаана. soffice байхгүй бол null.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'node-html-parser';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);

// soffice-ийн замыг олох (env → Docker/Linux → macOS)
const CANDIDATES = [
  process.env.LIBREOFFICE_BIN,
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  'soffice',
  'libreoffice',
].filter(Boolean);

let _bin = null;
async function findSoffice() {
  if (_bin !== null) return _bin || null;
  for (const c of CANDIDATES) {
    try {
      await execFileP(c, ['--version'], { timeout: 15000 });
      _bin = c;
      return c;
    } catch {
      /* дараагийнхыг үзнэ */
    }
  }
  _bin = false;
  return null;
}

export async function isLibreOfficeAvailable() {
  return (await findSoffice()) != null;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' };

// docx/xlsx буфер → self-contained HTML (эх хэвээр)
export async function officeToHtml(buffer, ext) {
  const bin = await findSoffice();
  if (!bin) return null;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lo-'));
  const profile = `file://${path.join(dir, 'profile')}`;
  const inFile = path.join(dir, `in.${ext}`);
  try {
    await fs.writeFile(inFile, buffer);
    // Тусдаа UserInstallation → зэрэг ажиллахад түгжрэлгүй
    await execFileP(
      bin,
      ['--headless', `-env:UserInstallation=${profile}`, '--convert-to', 'html', '--outdir', dir, inFile],
      { timeout: 90000, env: { ...process.env, HOME: dir } }
    );
    const outHtml = path.join(dir, 'in.html');
    let raw = await fs.readFile(outHtml, 'utf8');

    // Гарсан HTML доторх зургийн файлуудыг base64 болгож шингээх
    const root = parse(raw, { comment: false });
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (/^data:/i.test(src) || /^https?:/i.test(src)) continue;
      try {
        const imgPath = path.join(dir, path.basename(src));
        const data = await fs.readFile(imgPath);
        const e = (src.split('.').pop() || 'png').toLowerCase();
        img.setAttribute('src', `data:${MIME[e] || 'image/png'};base64,${data.toString('base64')}`);
      } catch {
        /* зураг олдсонгүй — алгасна */
      }
    }

    // head доторх <style> + body-г нэгтгэж буцаана (self-contained, засварлах боломжтой)
    const headStyle = root.querySelectorAll('head style').map((s) => s.toString()).join('\n');
    const body = root.querySelector('body');
    const bodyInner = body ? body.innerHTML : root.toString();
    const html = `${headStyle}${bodyInner}`;
    return { html, warnings: [] };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

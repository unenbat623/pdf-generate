const $ = (id) => document.getElementById(id);
const editors = {
  src: $('editorSrc'),
  ja: $('editorJa'),
  en: $('editorEn'),
};

function escapeHtml(text = '') {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

// ---------- Overlay / status ----------
let overlaySafety;
function busy(on, text = 'Ажиллаж байна…', safetyMs = 60000) {
  $('overlayText').textContent = text;
  $('overlay').hidden = !on;
  clearTimeout(overlaySafety);
  // Аюулгүйн хамгаалалт: хугацаа хэтэрвэл ямар ч тохиолдолд overlay-г хаана.
  if (on) {
    overlaySafety = setTimeout(() => {
      $('overlay').hidden = true;
      setStatus('Хүсэлт удаж байгаа тул зогсоолоо. Дахин оролдоно уу.', 'err');
    }, safetyMs);
  }
}
// Overlay дээр дарвал хаагдана (гацсан үед гарах гарц).
document.getElementById('overlay').addEventListener('click', () => {
  document.getElementById('overlay').hidden = true;
  clearTimeout(overlaySafety);
});

// fetch-д хугацааны хязгаар (мөнхийн гацалтаас сэргийлнэ)
async function fetchTimeout(url, opts = {}, ms = 35000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}
let statusTimer;
function setStatus(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + kind;
  clearTimeout(statusTimer);
  if (msg) statusTimer = setTimeout(() => (el.textContent = ''), 5000);
}

// ---------- Provider badge ----------
fetch('/api/config')
  .then((r) => r.json())
  .then((c) => {
    const label = { claude: 'Claude', deepl: 'DeepL', google: 'Google', demo: 'DEMO горим' }[c.provider] || c.provider;
    $('provider').textContent = '🌐 ' + label;
    if (c.aiDesign) $('aiDesign').hidden = false; // AI дизайн идэвхтэй бол товч харуулна
  })
  .catch(() => ($('provider').textContent = '🌐 ?'));

// ---------- AI-аар дизайн сэргээх ----------
$('aiDesign').addEventListener('click', async () => {
  clearPlaceholder(editors.src);
  const text = editors.src.innerText.trim();
  if (!text) {
    setStatus('Эх хувь хоосон байна.', 'err');
    return;
  }
  if (!confirm('Эх хувийн текстийг AI-аар дизайнтай болгох уу? Одоогийн агуулга солигдоно.')) return;
  busy(true, '🤖 AI дизайн сэргээж байна… (30 сек хүртэл)', 130000);
  try {
    const res = await fetchTimeout('/api/reconstruct', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }, 120000);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI дизайн алдаа');
    editors.src.innerHTML = data.html;
    editors.ja.innerHTML = '';
    editors.en.innerHTML = '';
    saveDraft();
    setStatus('AI дизайн бэлэн. Шалгаад засаарай.', 'ok');
  } catch (err) {
    setStatus(err.name === 'AbortError' ? 'AI удаж хугацаа хэтэрлээ.' : err.message, 'err');
  } finally {
    busy(false);
  }
});

// ---------- Placeholder цэвэрлэх ----------
function clearPlaceholder(ed) {
  const ph = ed.querySelector('.placeholder');
  if (ph && ed.textContent.trim() === ph.textContent.trim()) ed.innerHTML = '';
}
Object.values(editors).forEach((ed) => {
  ed.addEventListener('focus', () => clearPlaceholder(ed));
});

// Word-ийг браузерт эх хэвээр (хүснэгт/зураг/формат) рэндэрлэх — docx-preview
async function importDocxClient(file) {
  const buf = await file.arrayBuffer();
  const tmp = document.createElement('div');
  await window.docx.renderAsync(buf, tmp, tmp, {
    inWrapper: false,
    ignoreWidth: false,
    ignoreHeight: true,
    breakPages: false,
    renderHeaders: true,
    renderFooters: true,
  });
  editors.src.innerHTML = tmp.innerHTML;
}

// ---------- Файл оруулах ----------
async function importFile(file) {
  const isDocx = /\.docx$/i.test(file.name);
  busy(true, `"${file.name}" уншиж байна…`, 180000);
  try {
    if (isDocx && window.docx) {
      // Word: браузерт эх хэвээр нь (хүснэгт, зураг, формат хадгална)
      await importDocxClient(file);
      showWarnings([]);
      saveDraft();
      setStatus(`"${file.name}" эх хэвээрээ ороллоо.`, 'ok');
      return;
    }
    // Бусад бүх төрөл: серверт задлан уншина
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetchTimeout('/api/import', { method: 'POST', body: fd }, 180000);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import алдаа');
    editors.src.innerHTML = sanitizeImported(data.html || '<p></p>');
    editors.ja.innerHTML = '';
    editors.en.innerHTML = '';
    showWarnings(data.warnings);
    saveDraft();
    setStatus(`"${data.name}" ороллоо.`, 'ok');
  } catch (err) {
    setStatus(err.name === 'AbortError' ? 'Файл уншихад хугацаа хэтэрлээ.' : err.message, 'err');
  } finally {
    busy(false);
  }
}

$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) await importFile(file);
  e.target.value = '';
});

// Импортын HTML-ийн фонтыг ХАДГАЛЖ (fidelity), ард нь fallback нэмнэ (ү/ө □ болохоос сэргийлнэ)
const FONT_FALLBACK = `"Carlito", "Liberation Sans", "Noto Sans", "Noto Sans CJK JP", "Hiragino Sans", Arial, sans-serif`;
function sanitizeImported(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style');
    if (/font-family\s*:/i.test(style) && !/Noto Sans/i.test(style)) {
      el.setAttribute(
        'style',
        style.replace(/font-family\s*:\s*([^;]+)/i, (m, fams) => `font-family: ${fams.trim()}, ${FONT_FALLBACK}`)
      );
    }
  });
  return tmp.innerHTML;
}

function showWarnings(warnings) {
  const box = $('warnings');
  if (!warnings || !warnings.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = '⚠ Анхаарах:<ul>' + warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>';
}

// ---------- Rich text toolbar ----------
$('toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  const block = btn.dataset.block;
  if (cmd) document.execCommand(cmd, false, null);
  if (block) document.execCommand('formatBlock', false, block);
});

// Зураг оруулах
$('imgInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    editors.src.focus();
    document.execCommand('insertHTML', false, `<img src="${reader.result}" style="max-width:100%"/>`);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Зураг чирж оруулах (drag & drop) — зураг бол шууд шигтгэнэ
editors.src.addEventListener('drop', (e) => {
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () =>
    document.execCommand('insertHTML', false, `<img src="${reader.result}" style="max-width:100%"/>`);
  reader.readAsDataURL(file);
});

// Баримтын файлыг цонх руу чирвэл бүтнээр нь импортлоно
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  const file = [...(e.dataTransfer?.files || [])][0];
  if (!file || file.type.startsWith('image/')) return; // зургийг дээрх зохицуулагч авна
  e.preventDefault();
  const current = editors.src.innerHTML.replace(/<[^>]+>/g, '').trim();
  if (current && !editors.src.querySelector('.placeholder') && !confirm(`"${file.name}"-ийг оруулах уу? Эх хувь дээрх агуулга солигдоно.`)) return;
  await importFile(file);
});

// ---------- Орчуулга ----------
async function translate(target) {
  clearPlaceholder(editors.src);
  const html = editors.src.innerHTML.trim();
  if (!html) {
    setStatus('Эх хувь хоосон байна.', 'err');
    return false;
  }
  busy(true, (target === 'ja' ? '日本語' : 'English') + ' руу орчуулж байна… (том баримт удаж болно)', 300000);
  try {
    const res = await fetchTimeout('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, target }),
    }, 300000);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Орчуулгын алдаа');
    editors[target].innerHTML = data.html;
    saveDraft();
    setStatus('Орчуулга бэлэн.', 'ok');
    return true;
  } catch (err) {
    setStatus(
      err.name === 'AbortError' ? 'Орчуулга удаж хугацаа хэтэрлээ. Дахин оролдоно уу.' : err.message,
      'err'
    );
    return false;
  } finally {
    busy(false);
  }
}

// ---------- Хэл солих таб ----------
let activeLang = 'src';
function isEmptyEditor(ed) {
  return !ed.innerHTML.replace(/<[^>]+>/g, '').replace(/&nbsp;|\s/g, '').trim() || ed.querySelector('.placeholder');
}
async function switchLang(lang) {
  // Таб идэвхжүүлэх
  document.querySelectorAll('.lang-tab').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.col').forEach((c) => c.classList.toggle('active', c.dataset.col === lang));
  activeLang = lang;
  // Доод талын татах сонголтыг тохируулах
  const sel = $('exportLang');
  if (sel) sel.value = lang;
  // Товчнуудыг харуулах/нуух
  $('retranslate').hidden = lang === 'src';
  $('copyCur').hidden = lang === 'src';
  // Орчуулгын таб + хоосон бол автоматаар орчуулах
  if ((lang === 'ja' || lang === 'en') && isEmptyEditor(editors[lang]) && !isEmptyEditor(editors.src)) {
    await translate(lang);
  }
}
document.querySelectorAll('.lang-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchLang(btn.dataset.lang));
});
$('retranslate').addEventListener('click', () => {
  if (activeLang === 'ja' || activeLang === 'en') translate(activeLang);
});
$('copyCur').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(editors[activeLang].innerText);
    setStatus('Хууллаа.', 'ok');
  } catch {
    setStatus('Хуулж чадсангүй.', 'err');
  }
});
// Доод талын татах сонголтыг өөрчилвөл таб мөн шилжинэ
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'exportLang') switchLang(e.target.value);
});

// ---------- Темплейт сонгох ----------
const tplModal = $('tplModal');
function buildTemplateGrid() {
  const grid = $('tplGrid');
  grid.innerHTML = '';
  (window.TEMPLATES || []).forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    card.innerHTML = `<div class="emoji">${t.emoji || '📄'}</div><div class="name">${t.name}</div><div class="desc">${t.desc || ''}</div>`;
    card.addEventListener('click', () => applyTemplate(t));
    grid.appendChild(card);
  });
}
function applyTemplate(t) {
  const cur = editors.src.innerHTML.replace(/<[^>]+>/g, '').trim();
  const hasContent = cur && !editors.src.querySelector('.placeholder');
  if (hasContent && !confirm(`"${t.name}" темплейтийг оруулах уу? Эх хувь дээрх одоогийн агуулга солигдоно.`)) return;
  editors.src.innerHTML = t.html;
  editors.ja.innerHTML = '';
  editors.en.innerHTML = '';
  saveDraft();
  tplModal.hidden = true;
  setStatus(`"${t.name}" темплейт орлоо.`, 'ok');
}
$('openTemplates').addEventListener('click', () => {
  buildTemplateGrid();
  tplModal.hidden = false;
});
$('tplClose').addEventListener('click', () => (tplModal.hidden = true));
tplModal.addEventListener('click', (e) => {
  if (e.target === tplModal) tplModal.hidden = true;
});

// ---------- Эх хувийг цэвэрлэх ----------
$('clearAll').addEventListener('click', () => {
  if (!confirm('Эх хувийг цэвэрлэх үү? (буцаах боломжгүй)')) return;
  editors.src.innerHTML = '<p></p>';
  editors.ja.innerHTML = '';
  editors.en.innerHTML = '';
  saveDraft();
  setStatus('Цэвэрлэлээ.', 'ok');
});

// ---------- Export: Word ----------
$('exportDocx').addEventListener('click', async () => {
  const lang = $('exportLang').value;
  const html = editors[lang].innerHTML;
  busy(true, 'Word бэлдэж байна…', 120000);
  try {
    const res = await fetchTimeout('/api/export/docx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, title: 'Баримт', lang }),
    }, 60000);
    if (!res.ok) throw new Error((await res.json()).error || 'Export алдаа');
    const blob = await res.blob();
    downloadBlob(blob, `document-${lang}.docx`);
    setStatus('Word татагдлаа.', 'ok');
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    busy(false);
  }
});

// ---------- Export: PDF (LaTeX / албан бичгийн стандарт) ----------
$('exportPdf').addEventListener('click', async () => {
  const lang = $('exportLang').value;
  const html = editors[lang].innerHTML;
  if (!html || !html.replace(/<[^>]+>/g, '').trim()) {
    setStatus('Татах агуулга хоосон байна.', 'err');
    return;
  }
  busy(true, 'PDF үүсгэж байна… (зурагтай том баримт удаж болно)', 240000);
  try {
    const res = await fetchTimeout(
      '/api/export/pdf',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html, lang }),
      },
      240000
    );
    if (!res.ok) throw new Error((await res.json()).error || 'PDF алдаа');
    const blob = await res.blob();
    downloadBlob(blob, `document-${lang}.pdf`);
    setStatus('PDF татагдлаа.', 'ok');
  } catch (err) {
    setStatus(err.name === 'AbortError' ? 'PDF үүсгэх хугацаа хэтэрлээ.' : err.message, 'err');
  } finally {
    busy(false);
  }
});

// ---------- Автомат хадгалалт (localStorage) ----------
const DRAFT_KEY = 'barimt-draft-v1';
const DRAFT_LIMIT = 3_500_000; // localStorage ойролцоогоор 5MB — зурагтай баримт багтахгүй
let saveTimer;
let draftWarned = false;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = JSON.stringify({
      src: editors.src.innerHTML,
      ja: editors.ja.innerHTML,
      en: editors.en.innerHTML,
      t: Date.now(),
    });
    if (payload.length > DRAFT_LIMIT) {
      // Зурагтай том баримт — хадгалахыг оролдох нь хөтчийг л удаашруулна
      localStorage.removeItem(DRAFT_KEY);
      if (!draftWarned) {
        draftWarned = true;
        setStatus('Баримт том тул автомат хадгалалт унтарлаа — ажлаа PDF/Word болгож татаж аваарай.', 'err');
      }
      return;
    }
    try {
      localStorage.setItem(DRAFT_KEY, payload);
    } catch {
      /* localStorage дүүрсэн байж магадгүй */
    }
  }, 600);
}
function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.src && d.src.replace(/<[^>]+>/g, '').trim()) {
      editors.src.innerHTML = d.src;
      editors.ja.innerHTML = d.ja || '';
      editors.en.innerHTML = d.en || '';
      const when = new Date(d.t).toLocaleString();
      setStatus(`Өмнөх draft сэргээгдлээ (${when}).`, 'ok');
    }
  } catch {
    /* алдаатай хадгаламж — алгасна */
  }
}
Object.values(editors).forEach((ed) =>
  ed.addEventListener('input', saveDraft)
);
restoreDraft();

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

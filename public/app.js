const $ = (id) => document.getElementById(id);
const editors = {
  src: $('editorSrc'),
  ja: $('editorJa'),
  en: $('editorEn'),
};

// ---------- Overlay / status ----------
let overlaySafety;
function busy(on, text = 'Ажиллаж байна…') {
  $('overlayText').textContent = text;
  $('overlay').hidden = !on;
  clearTimeout(overlaySafety);
  // Аюулгүйн хамгаалалт: 40 секундээс хойш ямар ч тохиолдолд overlay-г хаана.
  if (on) {
    overlaySafety = setTimeout(() => {
      $('overlay').hidden = true;
      setStatus('Хүсэлт удаж байгаа тул зогсоолоо. Дахин оролдоно уу.', 'err');
    }, 40000);
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
  })
  .catch(() => ($('provider').textContent = '🌐 ?'));

// ---------- Placeholder цэвэрлэх ----------
function clearPlaceholder(ed) {
  const ph = ed.querySelector('.placeholder');
  if (ph && ed.textContent.trim() === ph.textContent.trim()) ed.innerHTML = '';
}
Object.values(editors).forEach((ed) => {
  ed.addEventListener('focus', () => clearPlaceholder(ed));
});

// ---------- Файл оруулах ----------
$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  busy(true, 'Файл уншиж байна…');
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetchTimeout('/api/import', { method: 'POST', body: fd }, 60000);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import алдаа');
    editors.src.innerHTML = sanitizeImported(data.html || '<p></p>');
    showWarnings(data.warnings);
    saveDraft();
    setStatus(`"${data.name}" ороллоо.`, 'ok');
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    busy(false);
    e.target.value = '';
  }
});

// Импортын HTML-ийн фонтыг ХАДГАЛЖ (fidelity), ард нь fallback нэмнэ (ү/ө □ болохоос сэргийлнэ)
const FONT_FALLBACK = `"Noto Sans", "Noto Sans CJK JP", "Hiragino Sans", Arial, sans-serif`;
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
  box.innerHTML = '⚠ Анхаарах:<ul>' + warnings.map((w) => `<li>${w}</li>`).join('') + '</ul>';
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

// Зураг чирж оруулах (drag & drop)
editors.src.addEventListener('drop', (e) => {
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () =>
    document.execCommand('insertHTML', false, `<img src="${reader.result}" style="max-width:100%"/>`);
  reader.readAsDataURL(file);
});

// ---------- Орчуулга ----------
async function translate(target) {
  clearPlaceholder(editors.src);
  const html = editors.src.innerHTML.trim();
  if (!html) {
    setStatus('Эх хувь хоосон байна.', 'err');
    return false;
  }
  busy(true, (target === 'ja' ? '日本語' : 'English') + ' руу орчуулж байна…');
  try {
    const res = await fetchTimeout('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, target }),
    });
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
  busy(true, 'Word бэлдэж байна…');
  try {
    const res = await fetchTimeout('/api/export/docx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, title: 'Баримт' }),
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
  busy(true, 'Албан бичгийн стандарт PDF үүсгэж байна…');
  try {
    const res = await fetchTimeout(
      '/api/export/pdf',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html, lang }),
      },
      120000
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
let saveTimer;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          src: editors.src.innerHTML,
          ja: editors.ja.innerHTML,
          en: editors.en.innerHTML,
          t: Date.now(),
        })
      );
    } catch {
      /* localStorage дүүрсэн байж магадгүй (том зурагтай) */
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

// Залгаж/сольж болдог орчуулгын давхарга.
// TRANSLATE_PROVIDER=claude|deepl|google|demo (.env-ээс).
// Бүх провайдер HTML-ийг таг хадгалж орчуулна (зураг, формат хэвээр үлдэнэ).

const LANG_NAMES = { ja: 'Japanese (日本語)', en: 'English' };
const DEEPL_LANG = { ja: 'JA', en: 'EN-US' };
const GOOGLE_LANG = { ja: 'ja', en: 'en' };

// ---------- Claude (Anthropic) ----------
async function translateClaude(html, target) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY тохируулаагүй байна.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const langName = LANG_NAMES[target];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system:
        `You are a professional document translator for official/organizational documents. ` +
        `Translate ALL human-readable text in the given HTML into ${langName}. ` +
        `Preserve the HTML structure EXACTLY: keep every tag, attribute, class, and especially <img> "src" data URIs unchanged. ` +
        `Do NOT translate code, URLs, or data URIs. Keep a formal, official tone. ` +
        `Return ONLY the translated HTML, with no explanations or markdown fences.`,
      messages: [{ role: 'user', content: html }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API алдаа ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || '').join('').trim();
}

// ---------- DeepL ----------
async function translateDeepl(html, target) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error('DEEPL_API_KEY тохируулаагүй байна.');
  const base = process.env.DEEPL_API_URL || 'https://api-free.deepl.com';
  const body = new URLSearchParams();
  body.append('text', html);
  body.append('target_lang', DEEPL_LANG[target]);
  body.append('tag_handling', 'html');

  const res = await fetch(`${base}/v2/translate`, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`DeepL API алдаа ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.translations.map((t) => t.text).join('\n');
}

// ---------- Google Cloud Translation ----------
async function translateGoogle(html, target) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw new Error('GOOGLE_TRANSLATE_API_KEY тохируулаагүй байна.');
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: html, target: GOOGLE_LANG[target], format: 'html' }),
    }
  );
  if (!res.ok) throw new Error(`Google API алдаа ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.translations.map((t) => t.translatedText).join('\n');
}

// ---------- Demo (API key шаардахгүй) ----------
function translateDemo(html, target) {
  const tag = target === 'ja' ? '【DEMO 日本語】' : '[DEMO English]';
  // HTML-ийг хэвээр буцаана, зөвхөн эхэнд демо тэмдэг тавина.
  return `<div class="demo-note">${tag} — жинхэнэ орчуулга залгахын тулд .env дотор TRANSLATE_PROVIDER-ийг claude/deepl/google болгоно уу.</div>${html}`;
}

export function activeProvider() {
  return (process.env.TRANSLATE_PROVIDER || 'demo').toLowerCase();
}

export async function translateHtml(html, target) {
  if (!['ja', 'en'].includes(target)) throw new Error('target нь ja эсвэл en байх ёстой.');
  const provider = activeProvider();
  switch (provider) {
    case 'claude':
      return translateClaude(html, target);
    case 'deepl':
      return translateDeepl(html, target);
    case 'google':
      return translateGoogle(html, target);
    default:
      return translateDemo(html, target);
  }
}

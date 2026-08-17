// Зураг / скан PDF доторх текстийг AI vision-ээр (OCR) уншиж, засварлаж болох HTML болгоно.
// reconstruct.js-тэй адил RECONSTRUCT_PROVIDER=claude|gemini (.env) тохиргоог хэрэглэнэ.
import { sanitizeHtml } from './sanitize.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude/Gemini vision-ий зургийн дээд хэмжээ
const MAX_PDF_BYTES = 30 * 1024 * 1024;

const OCR_GUIDE = `You are a precise OCR engine for business documents, usually written in Mongolian Cyrillic.
Transcribe ALL visible text EXACTLY as printed — letter for letter.

RULES:
- Do NOT translate, "correct" spelling, summarize, reorder, or invent anything.
- Mongolian letters ү, ө, Ү, Ө must be preserved exactly. Never replace them with у, о, Y, O.
- Keep every number, date, punctuation mark, and unit exactly as shown.
- Reproduce document structure as clean HTML: headings → <h2>/<h3>, paragraphs → <p>, lists → <ul>/<ol>.
- Tables and bordered forms → <table class="doc-datatable"> with correct <tr>/<th>/<td>, using colspan/rowspan for merged cells. Keep empty cells as <td></td> so columns stay aligned.
- Label : value forms → <table class="doc-infotable"><tr><td class="label">LABEL</td><td>VALUE</td></tr></table>.
- Keep the original reading order. For multi-column pages, read column by column.
- Stamps, signatures, logos: describe briefly in square brackets, e.g. <p>[Тамга]</p>.
- If a word is truly unreadable, transcribe your best guess — do not omit it.
- Output ONLY the inner HTML (no <html>, <head>, <body>, <style>, no markdown code fences, no commentary).`;

const USER_PROMPT = 'Transcribe this document to HTML exactly as instructed.';

export function ocrProvider() {
  return (process.env.RECONSTRUCT_PROVIDER || '').toLowerCase();
}

/**
 * Түлхүүрийг цэвэрлэж шалгана: зай/хашилт/"Bearer" угтварыг авч хаяна.
 * cURL команд, тайлбар текст зэрэг илүү зүйл хамт хуулагдсан бол дотроос нь
 * жинхэнэ түлхүүрийг (AQ... / AIza... / sk-ant-...) өөрөө ялгаж авна.
 */
export function cleanApiKey(raw, name) {
  let key = String(raw || '').trim().replace(/^["']|["']$/g, '').trim();
  if (!key) return '';
  key = key.replace(/^bearer\s+/i, '');
  if (!/^[\x21-\x7e]+$/.test(key)) {
    const found = key.match(/(AQ\.[A-Za-z0-9_.-]{20,}|AIza[A-Za-z0-9_-]{30,}|sk-ant-[A-Za-z0-9_-]{30,})/);
    if (found) return found[1];
    throw new Error(
      `${name} буруу байна: түлхүүрт зай эсвэл кирилл үсэг орсон. Зөвхөн түлхүүрийг өөрийг нь (AQ... эсвэл AIza... гэж эхэлдэг) тавина уу.`
    );
  }
  return key;
}

/** OCR ашиглах боломжтой эсэх (провайдер + түлхүүр тохируулагдсан үед). */
export function ocrAvailable() {
  const p = ocrProvider();
  if (p === 'claude') return Boolean(process.env.ANTHROPIC_API_KEY);
  if (p === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
  return false;
}

/** API түр ачаалалтай (429/500/503/529) үед 3 хүртэл удаа дахин оролдоно. */
async function postWithRetry(url, options) {
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(url, options);
    if (res.ok || ![429, 500, 503, 529].includes(res.status)) return res;
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2500));
  }
  return res;
}

// Gemini-ийн шинэ AQ түлхүүр Google-ийн серверээс хамаарч янз бүрийн auth хэлбэр
// шаарддаг (шилжилтийн үеийн зөрчил). Аль ажилласныг санаж, дараагийн дуудлагад шууд хэрэглэнэ.
let geminiAuthMode = 'header';
let geminiUseOpenAi = false;

/** Gemini generateContent (native) — эхлээд санасан аргаар, 401/403 бол нөгөө аргаар дахин оролдоно. */
export async function geminiGenerate(model, key, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headersFor = (mode) => ({
    'content-type': 'application/json',
    ...(mode === 'header' ? { 'x-goog-api-key': key } : { authorization: `Bearer ${key}` }),
  });
  let res = await postWithRetry(url, { method: 'POST', headers: headersFor(geminiAuthMode), body });
  if (res.status === 401 || res.status === 403) {
    const other = geminiAuthMode === 'header' ? 'bearer' : 'header';
    const res2 = await postWithRetry(url, { method: 'POST', headers: headersFor(other), body });
    if (res2.ok) {
      console.log(`gemini: auth арга «${other}» ажиллалаа — цаашид үүнийг хэрэглэнэ`);
      geminiAuthMode = other;
    }
    return res2.ok ? res2 : res;
  }
  return res;
}

/**
 * Gemini-ээс текст авах нэгдсэн орц: эхлээд native endpoint (2 auth арга),
 * 401/403 хэвээр бол OpenAI-нийцтэй endpoint (Bearer) руу автоматаар шилжинэ —
 * AQ түлхүүр зарим Google серверт зөвхөн тэнд ажилладаг.
 */
export async function geminiText({ model, key, system, parts, maxTokens = 16000, temperature = 0, thinkingBudget = null }) {
  if (!geminiUseOpenAi) {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        ...(thinkingBudget != null ? { thinkingConfig: { thinkingBudget } } : {}),
      },
    });
    const res = await geminiGenerate(model, key, body);
    if (res.ok) {
      const data = await res.json();
      return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    }
    if (res.status !== 401 && res.status !== 403) {
      throw new Error(`Gemini API алдаа ${res.status}: ${await res.text()}`);
    }
  }

  const content = parts.map((p) => {
    if (p.text != null) return { type: 'text', text: p.text };
    const { mime_type: mime, data } = p.inline_data;
    return mime === 'application/pdf'
      ? { type: 'file', file: { filename: 'document.pdf', file_data: `data:${mime};base64,${data}` } }
      : { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } };
  });
  const res = await postWithRetry('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      max_tokens: maxTokens,
      temperature,
      ...(thinkingBudget != null ? { extra_body: { google: { thinking_config: { thinking_budget: thinkingBudget } } } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Gemini API алдаа ${res.status}: ${await res.text()}`);
  if (!geminiUseOpenAi) {
    console.log('gemini: OpenAI-нийцтэй endpoint ажиллалаа — цаашид үүнийг хэрэглэнэ');
    geminiUseOpenAi = true;
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message?.content;
  return (typeof msg === 'string' ? msg : (msg || []).map((x) => x.text || '').join('')).trim();
}

// ---------- Claude ----------
async function claudeOcr(source) {
  const key = cleanApiKey(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY тохируулаагүй.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const res = await postWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      temperature: 0,
      system: OCR_GUIDE,
      messages: [{ role: 'user', content: [source, { type: 'text', text: USER_PROMPT }] }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API алдаа ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || '').join('').trim();
}

// ---------- Gemini ----------
async function geminiOcr(inlinePart) {
  const key = cleanApiKey(process.env.GEMINI_API_KEY, 'GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY тохируулаагүй.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  // OCR-д "бодох" шаардлагагүй — thinking токенг унтрааж, гаралтын багтаамжийг бүрэн ашиглана
  return geminiText({
    model,
    key,
    system: OCR_GUIDE,
    parts: [inlinePart, { text: USER_PROMPT }],
    maxTokens: 16000,
    temperature: 0,
    thinkingBudget: 0,
  });
}

function stripFences(html) {
  return html
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

async function runOcr(buffer, mime) {
  const b64 = buffer.toString('base64');
  const provider = ocrProvider();
  let html;
  if (provider === 'claude') {
    const source =
      mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
    html = await claudeOcr(source);
  } else if (provider === 'gemini') {
    html = await geminiOcr({ inline_data: { mime_type: mime, data: b64 } });
  } else {
    throw new Error('AI OCR идэвхгүй. .env-д RECONSTRUCT_PROVIDER=claude эсвэл gemini + түлхүүр тохируулна уу.');
  }
  return sanitizeHtml(stripFences(html));
}

/** Зураг (png/jpeg/gif/webp) → текст нь хэвээр хадгалагдсан HTML. */
export async function ocrImage(buffer, mime) {
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Зураг 5MB-с том тул AI уншиж чадахгүй. Жижигрүүлж (эсвэл чанарыг бууруулж) дахин оруулна уу.');
  }
  return runOcr(buffer, mime);
}

/** Скан (текстгүй) PDF → бүх хуудасны текст HTML болно. */
export async function ocrPdf(buffer) {
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error('PDF 30MB-с том тул AI уншиж чадахгүй. Хуваагаад оруулна уу.');
  }
  return runOcr(buffer, 'application/pdf');
}

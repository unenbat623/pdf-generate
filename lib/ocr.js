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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await postWithRetry(url, {
    method: 'POST',
    // Түлхүүрийг header-ээр явуулна — хуучин (AIza...) болон шинэ (AQ...) формат хоёуланд ажиллана
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: OCR_GUIDE }] },
      contents: [{ role: 'user', parts: [inlinePart, { text: USER_PROMPT }] }],
      // OCR-д "бодох" шаардлагагүй — thinking токенг унтрааж, гаралтын багтаамжийг бүрэн ашиглана
      generationConfig: { maxOutputTokens: 16000, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API алдаа ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
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

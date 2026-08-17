// PDF/текстийг AI-аар дизайнтай HTML болгож сэргээнэ (засаж болдог).
// RECONSTRUCT_PROVIDER=claude|gemini (.env). Манай doc-* CSS классуудыг ашиглана.
import { sanitizeHtml } from './sanitize.js';

const DESIGN_GUIDE = `You convert plain document text (often Mongolian, extracted from a PDF) into clean, editable HTML that reproduces a professional business-document DESIGN. Use ONLY these CSS classes (they are already defined — do not add <style>):

- Header line: <div class="doc-runhead"><span>LEFT</span><span class="r">RIGHT</span></div>
- Title block: <div class="doc-title"><h1>TITLE</h1><div class="sub">SUBTITLE</div></div>
- Plain section heading: <div class="doc-section-title">TEXT</div>
- Numbered section: <div class="doc-numsec"><span class="num">1</span><span class="ttl">TITLE</span></div>
- Issue/sub bar (colored): <div class="doc-issuebar">TEXT</div> (variants: class="doc-issuebar orange", class="doc-issuebar blue")
- Label/value table: <table class="doc-infotable"><tr><td class="label">LABEL</td><td>VALUE</td></tr></table>
  (colored label column variants on the table: class="doc-infotable t-red" | "t-orange" | "t-blue")
- Data/number table: <table class="doc-datatable"><tr><th>..</th>..</tr><tr><td>..</td>..</tr><tr class="total"><td>..</td>..</tr></table>
- Priority legend row: <div class="doc-legend"><div class="chip red">..</div><div class="chip orange">..</div><div class="chip blue">..</div></div>
- Cards row: <div class="doc-cards"><div class="card red"><div class="n">1. ..</div><div class="t">..</div><div class="bar"></div></div>...</div> (card variants: red/orange/blue)
- Flow arrows: <div class="doc-flow"><div class="step">A</div><span class="arrow">→</span><div class="step">B</div></div>

RULES:
- Preserve ALL text content faithfully; do NOT translate, summarize, or invent facts.
- Infer structure: turn label:value blocks into doc-infotable; numeric/tabular data into doc-datatable; priority/status groupings into doc-legend + doc-cards; process/step sequences into doc-flow; numbered top-level sections into doc-numsec.
- Keep Mongolian text exactly as-is (including ү, ө).
- Output ONLY the inner HTML (no <html>, <head>, <body>, <style>, no markdown code fences, no commentary).`;

// ---------- Claude ----------
async function reconstructClaude(text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY тохируулаагүй.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      temperature: 0,
      system: DESIGN_GUIDE,
      messages: [{ role: 'user', content: `Reconstruct this document as designed HTML:\n\n${text}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API алдаа ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || '').join('').trim();
}

// ---------- Gemini (Google AI Studio) ----------
async function reconstructGemini(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY тохируулаагүй.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    // Түлхүүрийг header-ээр явуулна — хуучин (AIza...) болон шинэ (AQ...) формат хоёуланд ажиллана
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: DESIGN_GUIDE }] },
      contents: [{ role: 'user', parts: [{ text: `Reconstruct this document as designed HTML:\n\n${text}` }] }],
      generationConfig: { maxOutputTokens: 16000, temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API алдаа ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

function cleanHtml(html) {
  // Магадгүй markdown fence-тэй ирвэл цэвэрлэнэ
  return html
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export function reconstructProvider() {
  return (process.env.RECONSTRUCT_PROVIDER || '').toLowerCase();
}

export async function reconstructHtml(text) {
  if (!text || !text.trim()) throw new Error('Текст хоосон.');
  const provider = reconstructProvider();
  let html;
  if (provider === 'claude') html = await reconstructClaude(text);
  else if (provider === 'gemini') html = await reconstructGemini(text);
  else throw new Error('AI дизайн идэвхгүй. .env-д RECONSTRUCT_PROVIDER=claude эсвэл gemini + түлхүүр тохируулна уу.');
  return sanitizeHtml(cleanHtml(html));
}

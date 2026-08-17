// Залгаж/сольж болдог орчуулгын давхарга.
// TRANSLATE_PROVIDER=claude|deepl|google|demo (.env-ээс).
//
// Арга барил: HTML-ийг бүтнээр нь илгээхгүй. Зөвхөн ТЕКСТ ЗАНГИЛААНУУДЫГ салгаж
// авч, багцлан орчуулаад буцаагаад тавина. Ингэснээр:
//   • зургийн data URI (олон MB) API руу огт явахгүй,
//   • хүснэгт/формат/дизайн 100% хэвээрээ үлдэнэ,
//   • том баримт багцалж явдаг тул хариу тасрахгүй.
import { parse, TextNode } from 'node-html-parser';

const LANG_NAMES = { ja: 'Japanese (日本語)', en: 'English' };
const DEEPL_LANG = { ja: 'JA', en: 'EN-US' };
const GOOGLE_LANG = { ja: 'ja', en: 'en' };

const MAX_BATCH_ITEMS = 60;
const MAX_BATCH_CHARS = 4000;
const CONCURRENCY = 3;

const SKIP_PARENTS = new Set(['style', 'script', 'code', 'pre']);
// Орчуулах шаардлагагүй агуулга: зөвхөн тоо, огноо, тэмдэгт
const NOT_TRANSLATABLE = /^[\s\d.,:;/\\%$€₮¥+()\-–—_*#@|[\]{}<>=~^&"'`№]*$/u;

const escapeText = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- текст зангилаа салгах ----------

function collectTextNodes(root) {
  const nodes = [];
  const walk = (node, insideSkip) => {
    for (const kid of node.childNodes) {
      if (kid instanceof TextNode) {
        // .text нь entity-г тайлсан бодит текст (&amp; → &) — орчуулгад үүнийг өгнө
        if (!insideSkip && kid.text.trim() && !NOT_TRANSLATABLE.test(kid.text)) nodes.push(kid);
        continue;
      }
      if (!kid.tagName) continue;
      walk(kid, insideSkip || SKIP_PARENTS.has(kid.tagName.toLowerCase()));
    }
  };
  walk(root, false);
  return nodes;
}

function makeBatches(texts) {
  const batches = [];
  let current = [];
  let chars = 0;
  texts.forEach((text, index) => {
    if (current.length >= MAX_BATCH_ITEMS || (current.length && chars + text.length > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push({ index, text });
    chars += text.length;
  });
  if (current.length) batches.push(current);
  return batches;
}

async function runBatches(batches, worker) {
  const results = new Array(batches.length);
  let cursor = 0;
  const runner = async () => {
    while (cursor < batches.length) {
      const i = cursor++;
      results[i] = await worker(batches[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, runner));
  return results;
}

// ---------- Claude (Anthropic) ----------

async function claudeBatch(items, target) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY тохируулаагүй байна.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system:
        `You translate fragments of an official/organizational document into ${LANG_NAMES[target]}. ` +
        `You receive a JSON array of strings. Return ONLY a JSON array of the SAME length, in the SAME order, ` +
        `where each element is the translation of the corresponding input element. ` +
        `Preserve leading/trailing whitespace of each fragment. Keep numbers, codes, dates and proper nouns as-is. ` +
        `Use a formal, official register. Do not merge, split, reorder, or add elements. Output raw JSON only — no markdown fences, no commentary.`,
      messages: [{ role: 'user', content: JSON.stringify(items.map((it) => it.text)) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API алдаа ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const raw = (data.content || []).map((c) => c.text || '').join('').trim();
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const out = JSON.parse(json);
  if (!Array.isArray(out) || out.length !== items.length) {
    throw new Error(`Орчуулгын хариу тохирсонгүй (${Array.isArray(out) ? out.length : '?'}/${items.length}).`);
  }
  return out.map((v) => String(v));
}

// ---------- DeepL ----------

async function deeplBatch(items, target) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error('DEEPL_API_KEY тохируулаагүй байна.');
  const base = process.env.DEEPL_API_URL || 'https://api-free.deepl.com';
  const body = new URLSearchParams();
  for (const it of items) body.append('text', it.text);
  body.append('target_lang', DEEPL_LANG[target]);

  const res = await fetch(`${base}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`DeepL API алдаа ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.translations || []).map((t) => t.text);
}

// ---------- Google Cloud Translation ----------

async function googleBatch(items, target) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw new Error('GOOGLE_TRANSLATE_API_KEY тохируулаагүй байна.');
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: items.map((it) => it.text), target: GOOGLE_LANG[target], format: 'text' }),
  });
  if (!res.ok) throw new Error(`Google API алдаа ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.data?.translations || []).map((t) =>
    String(t.translatedText).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  );
}

// ---------- Demo ----------

function demoBatch(items, target) {
  const tag = target === 'ja' ? '【JA】' : '[EN]';
  return items.map((it) => tag + it.text);
}

export function activeProvider() {
  return (process.env.TRANSLATE_PROVIDER || 'demo').toLowerCase();
}

// ---------- нэгдсэн орц ----------

export async function translateHtml(html, target) {
  if (!['ja', 'en'].includes(target)) throw new Error('target нь ja эсвэл en байх ёстой.');
  const provider = activeProvider();

  const root = parse(`<div id="translate-root">${html}</div>`, {
    blockTextElements: { script: false, noscript: false, style: true, pre: true },
    comment: false,
  });
  const wrapper = root.querySelector('#translate-root');
  const nodes = collectTextNodes(wrapper);
  if (!nodes.length) return html;

  const batchFn = { claude: claudeBatch, deepl: deeplBatch, google: googleBatch }[provider] || demoBatch;
  const batches = makeBatches(nodes.map((n) => n.text));

  const failures = [];
  const results = await runBatches(batches, async (items, i) => {
    try {
      const out = await batchFn(items, target);
      if (!Array.isArray(out) || out.length !== items.length) throw new Error('урт тохирсонгүй');
      return out;
    } catch (e) {
      failures.push(`${i + 1}: ${e.message}`);
      return items.map((it) => it.text); // энэ багц эх хэлээрээ үлдэнэ
    }
  });

  // Бүх багц бүтэлгүйтвэл алдааг нуухгүй — хэрэглэгчид мэдэгдэнэ
  if (failures.length === batches.length) throw new Error(failures[0].replace(/^\d+: /, ''));

  batches.forEach((items, b) => {
    const out = results[b];
    items.forEach((item, k) => {
      const node = nodes[item.index];
      const translated = out[k];
      if (typeof translated === 'string') {
        // Эх текстийн эхэн/төгсгөлийн зайг хадгална (хүснэгтийн эгнээ эвдрэхгүй).
        // rawText нь HTML рүү шууд бичигддэг тул заавал escape хийнэ.
        const lead = /^\s*/.exec(item.text)[0];
        const tail = /\s*$/.exec(item.text)[0];
        node.rawText = lead + escapeText(translated.trim()) + tail;
      }
    });
  });

  const translatedHtml = wrapper.innerHTML;
  if (provider === 'demo') {
    return `<div class="demo-note">DEMO горим — жинхэнэ орчуулга залгахын тулд .env дотор TRANSLATE_PROVIDER-ийг claude/deepl/google болгоно уу.</div>${translatedHtml}`;
  }
  return translatedHtml;
}

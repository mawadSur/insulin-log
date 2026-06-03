// Vercel serverless function: estimate carbohydrate grams from a food photo.
//
// SAFETY: This returns a rough, non-authoritative estimate that the user MUST
// review before it influences any insulin dose. It never returns an insulin
// dose, and the frontend only pre-fills an editable field with `grams`.
//
// Expects POST { image: "data:image/jpeg;base64,..." }.
// Responds 200 { grams:number, confidence:"low"|"medium"|"high", items:string[] }
// or a 4xx/5xx { message:string } that the frontend shows in Arabic-friendly UI.

const MODEL = 'claude-opus-4-8';

// Hard caps to protect the function (and the bill) from oversized input.
// MAX_BODY_BYTES is below Vercel's ~4.5MB platform limit so the streaming-path
// guard is actually reachable; MAX_IMAGE_BYTES bounds the decoded image and is
// enforced regardless of how the body was parsed.
const MAX_BODY_BYTES = 6 * 1024 * 1024;       // ~6 MB raw request
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;      // ~4 MB decoded image
const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Lightweight in-memory rate limiter. Per warm instance only (best-effort);
// pair with platform/WAF limits for hard guarantees. Caps cost from a single
// abusive caller hammering one instance.
const RL_WINDOW_MS = 60 * 1000;
const RL_MAX_PER_WINDOW = 10;       // per IP per minute
const RL_GLOBAL_PER_WINDOW = 60;    // per instance per minute (all callers)
const rlHits = new Map();           // ip -> [timestamps]
let rlGlobal = [];                  // recent global timestamps

function rateLimited(ip, now) {
  // prune + check global
  rlGlobal = rlGlobal.filter((t) => now - t < RL_WINDOW_MS);
  if (rlGlobal.length >= RL_GLOBAL_PER_WINDOW) return true;
  // prune + check per-ip
  const arr = (rlHits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX_PER_WINDOW) { rlHits.set(ip, arr); return true; }
  arr.push(now); rlHits.set(ip, arr);
  rlGlobal.push(now);
  // opportunistic cleanup so the map can't grow unbounded
  if (rlHits.size > 5000) {
    for (const [k, v] of rlHits) { if (!v.some((t) => now - t < RL_WINDOW_MS)) rlHits.delete(k); }
  }
  return false;
}

// Extract the first balanced {...} object from model text (robust to any prose).
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

// Best-effort client IP from proxy headers.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// Allow requests only from the deployment's own origin (and local dev).
function originAllowed(req) {
  const origin = req.headers.origin || '';
  if (!origin) return true; // same-origin fetches often omit Origin; not a CSRF risk for JSON-only POST
  try {
    const host = new URL(origin).host;
    const self = req.headers.host || '';
    if (host === self) return true;
    if (/(^|\.)vercel\.app$/.test(host)) return true;       // preview + prod deployments
    if (/^localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1/.test(host)) return true;
    return false;
  } catch { return false; }
}

const SYSTEM_PROMPT = [
  'You are a nutrition estimation assistant for a diabetes logging app.',
  'Given a photo of food, estimate the TOTAL digestible carbohydrates in grams for the portion shown.',
  'Rules:',
  '- Respond with ONLY a JSON object, no prose, no markdown fences.',
  '- Shape: {"grams": <integer>=0>, "confidence": "low"|"medium"|"high", "items": [<short strings>]}.',
  '- "items" lists the main foods you see (in Arabic when natural, else English), max 6 entries.',
  '- If the image does not clearly contain food, return {"grams": 0, "confidence": "low", "items": []}.',
  '- Be conservative. Portion sizes from photos are uncertain; prefer "low"/"medium" confidence.',
  '- Never include insulin advice, doses, or medical recommendations. Carbs only.'
].join('\n');

function readJsonBody(req) {
  // Vercel may pre-parse JSON into req.body; otherwise read the stream.
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error('invalid JSON'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function parseDataUrl(dataUrl) {
  // data:image/jpeg;base64,XXXX
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  if (!ALLOWED_MEDIA.includes(mediaType)) return null;
  const base64 = m[2].replace(/\s/g, '');
  const approxBytes = Math.floor(base64.length * 3 / 4);
  if (approxBytes > MAX_IMAGE_BYTES) return null;
  return { mediaType, base64 };
}

function clampGrams(n) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  let g = Math.round(n);
  if (g < 0) g = 0;
  if (g > 1000) g = 1000;     // sanity ceiling for a single plate
  return g;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // No caching of estimates.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ message: 'الطريقة غير مسموحة.' }));
  }

  // Reject cross-origin callers so the billable endpoint only serves our app.
  if (!originAllowed(req)) {
    res.statusCode = 403;
    return res.end(JSON.stringify({ message: 'الطلب غير مسموح من هذا المصدر.' }));
  }

  // Best-effort rate limit to cap cost from abuse.
  const now = Date.now();
  if (rateLimited(clientIp(req), now)) {
    res.statusCode = 429;
    res.setHeader('Retry-After', '60');
    return res.end(JSON.stringify({ message: 'طلبات كثيرة جدًا. انتظر دقيقة ثم حاول مجددًا، أو أدخل الكربوهيدرات يدويًا.' }));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ message: 'ميزة التقدير غير مُهيّأة بعد على الخادم.' }));
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    res.statusCode = e.statusCode || 400;
    return res.end(JSON.stringify({ message: 'الطلب غير صالح أو كبير جدًا.' }));
  }

  const parsed = parseDataUrl(body && body.image);
  if (!parsed) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ message: 'صورة غير صالحة أو كبيرة جدًا. التقط صورة أوضح أو أصغر.' }));
  }

  let Anthropic;
  try {
    const mod = require('@anthropic-ai/sdk');
    Anthropic = mod.default || mod;
  } catch {
    res.statusCode = 500;
    return res.end(JSON.stringify({ message: 'تعذّر تحميل خدمة التقدير.' }));
  }

  const client = new Anthropic({ apiKey });

  let message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.base64 } },
          { type: 'text', text: 'قدّر إجمالي الكربوهيدرات بالغرام لهذه الوجبة. أعد JSON فقط.' }
        ]
      }]
    });
  } catch (e) {
    // Distinguish upstream API failures so the client gets the right status.
    const status = e && (e.status || e.statusCode);
    console.error('estimate: Anthropic API error', status || '', e && e.message);
    if (status === 429) {
      res.statusCode = 429;
      res.setHeader('Retry-After', '30');
      return res.end(JSON.stringify({ message: 'الخدمة مشغولة الآن. حاول بعد قليل أو أدخل الكربوهيدرات يدويًا.' }));
    }
    if (status === 529 || status === 503 || (status >= 500 && status < 600)) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ message: 'خدمة التقدير غير متاحة مؤقتًا. أدخل الكربوهيدرات يدويًا.' }));
    }
    res.statusCode = 502;
    return res.end(JSON.stringify({ message: 'تعذّر الاتصال بخدمة التقدير. أدخل الكربوهيدرات يدويًا.' }));
  }

  try {
    const text = (message.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Extract the first balanced JSON object even if the model wrapped it in prose.
    const jsonStr = extractJsonObject(text);
    if (!jsonStr) throw new Error('no json in model output');
    const out = JSON.parse(jsonStr);

    const grams = clampGrams(out.grams);
    if (grams === null) throw new Error('no usable grams');

    const confidence = ['low', 'medium', 'high'].includes(out.confidence) ? out.confidence : 'low';
    const items = Array.isArray(out.items)
      ? out.items.filter((s) => typeof s === 'string').slice(0, 6).map((s) => s.slice(0, 40))
      : [];

    res.statusCode = 200;
    return res.end(JSON.stringify({ grams, confidence, items }));
  } catch (e) {
    console.error('estimate: parse error', e && e.message);
    res.statusCode = 502;
    return res.end(JSON.stringify({ message: 'تعذّر تحليل الصورة. أدخل الكربوهيدرات يدويًا.' }));
  }
};

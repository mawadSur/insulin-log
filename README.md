# سجلّ الإنسولين · Insulin Log

An Arabic (RTL) insulin dose **calculator and logger** with optional **AI food-photo carb estimation**. It does the arithmetic for the dosing parameters *your clinician prescribed* — it does not decide your numbers.

> ⚠️ **ليست نصيحة طبية / Not medical advice.** This tool only performs math using values you enter from your own treatment plan, plus an optional, approximate AI carb estimate you must verify. Always confirm doses with your healthcare provider. Insulin errors can be life-threatening — never act on an estimate you're unsure about.

## What it does

- **Calculate** (احسب) an estimated dose from carbs, current blood glucose, and insulin-on-board (IOB).
  - Carb coverage = `carbs ÷ ICR`
  - Correction = `(BG − target) ÷ ISF` (optionally only above a threshold)
  - Total = carb coverage + correction − IOB, floored at 0, rounded to your configured increment.
- **Food photo → AI carb estimate** (optional): take/upload a photo; a serverless function calls Claude vision to estimate carbohydrate grams. The estimate **pre-fills an editable field that you must review** — it never auto-submits or computes a dose on its own.
- **Log** (السجلّ) estimates locally, with the food photo and an "AI-estimated" badge attached.
- **Settings** (الإعدادات) for your prescribed parameters: glucose units (mg/dL or mmol/L), ICR, ISF/correction factor, target BG, insulin type, rounding increment, and correction threshold.

## Safety design

The AI carb number influences an insulin dose, so the app is deliberately conservative:

- The estimate only **pre-fills an editable field**; the dose is computed solely when *you* press "احسب".
- **Low-confidence** estimates do **not** auto-fill — they require an explicit tap to accept.
- A "no food detected" result (`grams: 0`) shows a message instead of silently entering 0.
- An **"AI-estimated" badge** travels onto the result panel and the saved log entry.
- **Hard warnings** fire for implausibly large carb intake (>250 g) or large doses (≥25 units).
- The vision prompt is constrained to carbs only and is forbidden from giving dosing advice.

## Privacy

The log and settings stay in your browser (in-memory for the session). **Food photos are uploaded to the AI service only when you press "قدّر" (estimate)** — nothing else leaves the device. This is stated in the app footer.

## Architecture

- `index.html` — the entire client app (HTML + CSS + vanilla JS, RTL, no framework).
- `api/estimate.js` — Vercel serverless function. Validates the image, enforces size caps, applies an Origin check + best-effort rate limiting, calls Claude vision, and returns `{ grams, confidence, items }`.
- Requires the `ANTHROPIC_API_KEY` environment variable (set in the Vercel project). Without it, the calculator/logger still work; only the AI estimate is disabled.

## Deploy

```bash
vercel deploy --prod          # static page + serverless function
vercel env add ANTHROPIC_API_KEY production   # required for the AI estimate
```

The static page also works standalone (open `index.html`); the AI estimate needs the serverless endpoint.

## Disclaimer

Built as a personal logging aid — **not a medical device**. Use at your own risk and always verify doses with a qualified healthcare provider.

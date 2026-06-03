# Insulin Log — Project Notes

## What this is
A bilingual (Arabic RTL / English LTR) insulin dose **calculator + logger** with optional **AI food-photo carb estimation**.
- `index.html` — the entire client app (HTML + CSS + vanilla JS, no build step). Default `dir="rtl" lang="ar"`; fonts Cairo + IBM Plex Sans Arabic (Arabic) and Inter (English) via `@import`.

## i18n (language toggle)
- All UI strings live in the `T = {ar:{...}, en:{...}}` dictionary in the inline script. `t(key, params)` looks up the current `LANG` with `{param}` interpolation; missing keys fall back to Arabic then the key itself.
- Static text uses `data-i18n` (textContent), `data-i18n-html` (innerHTML, for strings with `<b>`/`<span>`), `data-i18n-ph` (placeholder), `data-i18n-alt` (alt). `applyStaticI18n()` walks these.
- `applyLang(lang)` sets `LANG`, persists to `localStorage.insulinLang`, flips `documentElement.dir`/`lang`, swaps fonts (CSS `html[lang=en]`), and **re-renders dynamic surfaces**: `renderAiEst()`, `renderResultPanel()` (from `lastResult`), `renderLog()`. When adding dynamic strings, route them through `t()` and make sure the surface is re-rendered on switch.
- `lastResult` holds the structured calc inputs (not pre-formatted text) so the result panel can re-render in either language. `lastAi` holds the AI estimate/error state for the same reason. Do not bake language into stored state.
- `/api/estimate` takes a `lang` param ('ar'|'en') and returns food `items` in that language (`systemPrompt(lang)` + user text).
- `api/estimate.js` — Vercel serverless function: Claude vision → `{grams, confidence, items}`.
- Deployed on **Vercel** (static page + function). Also pushed to GitHub; GitHub Pages serves only the static page (the AI estimate needs the serverless endpoint, so Pages can't do estimation).

## Structure
- Three tabs (`احسب` / `السجلّ` / `الإعدادات`) toggled by `.tab` buttons; client logic is one IIFE in the `<script>` at the bottom of `index.html`.
- `api/estimate.js` needs env var `ANTHROPIC_API_KEY` (set in Vercel project, encrypted). Without it the function returns 503 and the calculator/logger still work.

## Key conventions
- **No medical decisions in code.** Arithmetic only. Preserve the "ليست نصيحة طبية" disclaimer and all safety warnings — they are load-bearing.
- Dose math (`calcBtn` handler): carbCoverage = `carbs/ICR`; correction = `(BG−target)/ISF` (skipped below `corrThresh`); total = `carbCoverage + correction − IOB`, floored at 0, rounded via `roundDose()`.
- **AI → dose safety path** (post-adversarial-review, do not regress):
  - The AI estimate only *pre-fills the editable carbs field*; it never auto-submits.
  - `confidence==='low'` → do NOT auto-fill; require an explicit accept tap.
  - `grams===0` with no items → "no food detected" message, no pre-fill.
  - `aiCarb` state tracks AI-sourced carbs; editing the field manually clears it (`clearAiCarb`).
  - An AI badge travels to the result panel (`rAiBadge`) and the log entry (`e.aiCarb`).
  - Hard warnings (`hardWarn`): carbs > 250 g or dose ≥ 25 units.
- **RTL/bidi:** wrap math fragments in `ltr(...)` (a `dir=ltr; unicode-bidi:isolate` span) so `(180 − 110) ÷ 50` doesn't reorder. Units are spelled out (`وحدة`, `غ`), not a bare `و`.
- **Serverless security:** Origin check (`originAllowed`), in-memory rate limiter (`rateLimited`), image size caps, balanced-brace JSON extractor (`extractJsonObject`), and API-error-vs-parse-error distinction with `console.error` logging.
- State (`S`, `logEntries`) is **in-memory only** — it does NOT persist across reloads. If asked to add persistence, use `localStorage` and keep the footer copy accurate.

## Privacy invariant
Footer states photos are uploaded to the AI service *only* when the user presses "قدّر". If you change when/what is sent, update that copy to stay honest.

## Dev/test
- `npm install` pulls `@anthropic-ai/sdk` (runtime dep). `node_modules` is gitignored and in `.vercelignore` (Vercel installs deps itself).
- Logic was verified with a jsdom harness (Image/canvas/fetch stubbed) — see git history. Don't commit `jsdom`/test files as runtime deps.

## Style
- Dark theme, CSS custom properties in `:root`. Match the existing vanilla-JS idiom (`var`, `$` helper, no frameworks). Keep client single-file.

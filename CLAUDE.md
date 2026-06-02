# Insulin Log — Project Notes

## What this is
A single-file static web app: an insulin dose **calculator + logger**. Everything lives in `index.html` (HTML + CSS + vanilla JS, no build step, no dependencies except Google Fonts loaded via `@import`).

## Structure
- `index.html` — the entire app. Three tabs (`Calculate`, `Log`, `Settings`) toggled by `.tab` buttons; logic is one IIFE in the `<script>` at the bottom.
- Deployed via **GitHub Pages** from the repo root, so the entry point must stay named `index.html`.

## Key conventions
- **No medical decisions in code.** This tool only does arithmetic on user-entered prescription values. Preserve the "Not medical advice" disclaimer and the low/negative-dose safety warnings — they are load-bearing, not decoration.
- Dose math (see the `calcBtn` handler):
  - Carb coverage = `carbs / ICR`
  - Correction = `(BG − target) / ISF`, skipped when BG is below the optional `corrThresh`
  - Total = `carbCoverage + correction − IOB`, floored at 0, rounded via `roundDose()` to `S.round`.
- State (`S`, `logEntries`) is **in-memory only** — it does NOT persist across reloads despite the "saved on this device" copy. If asked to add persistence, use `localStorage` and update the README/footer wording to match.
- Glucose units toggle between `mg/dL` and `mmol/L`; unit labels are refreshed via `refreshUnits()`.

## Style
- Dark theme, CSS custom properties in `:root`. Fonts: Fraunces (display) + Spline Sans Mono (body).
- Match existing vanilla-JS idiom (`var`, `$ = getElementById` helper, no frameworks). Keep it dependency-free and single-file unless told otherwise.

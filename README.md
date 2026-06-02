# Insulin Log

A single-file, offline insulin dose **calculator and logger**. It does the arithmetic for the dosing parameters *your clinician prescribed* — it does not decide your numbers.

> ⚠️ **Not medical advice.** This tool only performs math using values you enter from your own treatment plan. Always confirm doses with your healthcare provider. Insulin errors can be life-threatening — never act on an estimate you're unsure about.

## What it does

- **Calculate** an estimated dose from carbs, current blood glucose, and insulin-on-board (IOB).
  - Carb coverage = `carbs ÷ ICR`
  - Correction = `(BG − target) ÷ ISF` (optionally only above a threshold)
  - Total = carb coverage + correction − IOB, rounded to your configured increment.
- **Log** estimates locally for your own record.
- **Settings** for your prescribed parameters: glucose units (mg/dL or mmol/L), ICR, ISF/correction factor, target BG, insulin type, rounding increment, and correction threshold.

## Privacy

Everything runs in your browser. No data is uploaded or stored on any server. (Note: the current build keeps log/settings in memory for the session only — see below.)

## Usage

Open `index.html` in any modern browser, or visit the GitHub Pages deployment. No build step, no dependencies (fonts load from Google Fonts).

## Disclaimer

Built as a personal logging aid — **not a medical device**. Use at your own risk and always verify doses with a qualified healthcare provider.

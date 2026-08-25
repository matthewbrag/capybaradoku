# Capybaradoku 🐹

A cozy capybara logic puzzle — a Meowdoku/LinkedIn-Queens–style game, built as an
offline, installable PWA (no ads, no server, no tracking).

**Rules:** place one capybara in every row, every column, and every colour patch.
No two capybaras may touch, even diagonally. You get 3 hearts.

## Run locally

```bash
npm run serve      # serves at http://localhost:8877
```

Open it in a browser. On iOS Safari: **Share → Add to Home Screen** to install it
as a standalone app that works offline.

## How it works

- **Deterministic levels.** Level *N* is identical on every device, so you and a
  friend can compare "level 67". Puzzles are pre-baked into `src/levels.json`.
- **Guaranteed unique solution.** The generator refines the colour regions until
  a solution-counter confirms exactly one solution.
- **Measured difficulty.** A human-style logical solver grades each puzzle by the
  hardest deduction technique it's forced to use (singles → confinement →
  subsets → trial).

## Project layout

| File | Purpose |
|------|---------|
| `index.html`, `styles.css` | app shell + UI |
| `src/game.js` | game controller, rendering, rules, hearts |
| `src/generator.js` | deterministic puzzle generation + region refinement |
| `src/solver.js` | uniqueness counter + difficulty grader |
| `src/rng.js` | seeded PRNG (determinism) |
| `src/levels.json` | pre-baked level pack |
| `tools/bake.mjs` | regenerate the level pack (`npm run bake`) |
| `tools/make-icons.mjs` | placeholder app icons (`npm run icons`) |
| `sw.js`, `manifest.webmanifest` | PWA offline + install |

## Swapping in real capybara art

- **Board token:** replace `CAPY_SVG` in `src/game.js` with an `<img>` (data URI
  or a file in `icons/`).
- **App icon:** replace `icons/icon-180/192/512.png` with real art (keep sizes).

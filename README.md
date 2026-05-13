# FitCoach

A standalone, offline-capable **Progressive Web App** that acts as a personal
vegetarian dietitian and home-workout trainer. Designed for a single user, with
all data stored locally on the device (IndexedDB) — no backend, no login, no
analytics.

## Features

- **Today screen** — circular ring chart for daily calorie deficit, macros bars,
  12-glass water tracker, suggested next meal, prescribed workout.
- **Smart food logging** — search a database of 170+ Indian vegetarian (no-egg)
  foods with accurate per-serving macros; add custom items that persist.
- **Workout prescription** — phased program (walking-first for the first 2 weeks,
  bodyweight circuits added gradually) tuned to current weight and BMI; all
  exercises are no-equipment.
- **Real-time course correction** — when you go over budget, pick a corrective
  action (extra walk, skip the snack, swap to a lighter dinner).
- **Coach tab** — built-in rule-based answers, or paste an Anthropic API key
  for full Claude-powered coaching with your live profile and daily data as
  context.
- **Trends** — weight chart with target trajectory, calories in/out bars,
  90-day adherence heatmap, projected target date.
- **Settings** — edit profile, override daily targets, export/import JSON
  backup, clear all data.

## Safety rails

- Never recommends below BMR (~1,950 kcal/day) intake.
- Caps a single-day deficit at 1,000 kcal target.
- Plateau coach surfaces only after 14+ days of flat weight.
- Coach falls back to a medical disclaimer when symptoms are mentioned.
- Weight entries > 3 kg daily swing prompt a confirmation.

## Tech

- Vanilla HTML / CSS / ES-module JS — no build step.
- Storage: IndexedDB via `idb` (CDN ESM).
- Charts: Chart.js (CDN ESM).
- PWA: hand-rolled service worker, app shell cached for offline use.

## Run locally

Any static server works. From the repo root:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

## Deploy on GitHub Pages

1. Push to GitHub.
2. Repo Settings → Pages → Source: **main**, Folder: **/(root)**.
3. The app will be available at `https://<your-user>.github.io/<repo>/`.

No build step required.

## Install on iPhone

1. Open the GitHub Pages URL in **Safari** (not Chrome).
2. Tap the **Share** icon → **Add to Home Screen** → **Add**.
3. Launch from the home-screen icon. It runs full-screen without browser chrome
   and works offline after the first load.

## AI Coach setup

The Coach tab works without any API key (uses built-in rule-based answers). For
full AI coaching:

1. Get an Anthropic API key at <https://console.anthropic.com>.
2. **Settings → AI Coach → API key**, paste, save.
3. The key is stored only in your browser's IndexedDB.

API calls go directly from your browser to Anthropic — never through a backend.

## Data portability

- **Export**: Settings → Export data. Produces `fitcoach-backup-YYYY-MM-DD.json`
  with every store.
- **Import**: Settings → Import data. Replace or merge.

## Project structure

```
.
├── index.html
├── manifest.json
├── sw.js
├── css/styles.css
├── js/
│   ├── app.js            # router + bootstrap
│   ├── db.js             # IndexedDB layer (idb wrapper)
│   ├── state.js          # global context + today's snapshot
│   ├── utils.js          # date, DOM, modal, toast helpers
│   ├── profile.js        # BMR/TDEE/targets
│   ├── data/foods.js     # 170+ seed foods
│   ├── data/exercises.js # 44 seed exercises
│   ├── engine/
│   │   ├── meals.js        # next-meal suggestion algorithm
│   │   ├── workout.js      # workout prescription algorithm
│   │   └── correction.js   # over-budget course correction
│   ├── coach/
│   │   ├── rules.js        # rule-based coach answers
│   │   └── claude.js       # Anthropic API integration
│   └── views/
│       ├── today.js
│       ├── log.js
│       ├── coach.js
│       ├── trends.js
│       └── settings.js
└── icons/                # PWA icons (PNG + SVG)
```

## License

Personal use.

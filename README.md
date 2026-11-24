# health hub.

A personal health and weight-loss tracker that installs on iPhone as a home-screen app.

**Open it:** https://steveroe21.github.io/health-hub/

## What it does

- **Weight**: log weigh-ins and see them on a chart. Set a goal weight and a target date, and a straight goal line shows where you should be on each day. Stats include change since start, kg to go, pace needed, 7-day average, 4-week trend and the date you'd hit your goal on that trend.
- **Lifting**: a full workout logger. Start an empty workout or a routine, add exercises from a built-in library of ~390 (or your own), and log every set: previous numbers, set types (warm-up, drop, failure), rest timer, PR detection. Workouts can be edited, saved as routines, and feed the weekly volume chart. Hevy CSV imports keep every set too. Volume is weight × reps; pull-ups, chin-ups, dips, push-ups, muscle-ups, inverted rows, squats, lunges and step-ups also count your body weight (your latest weigh-in on that day) × reps, plus any added weight or minus any assistance.
- **Running**: log distance and time (pace is worked out for you). You see weekly distance totals.
- **Steps**: one total per day. You see weekly totals and the daily average you need for the rest of the week.
- **Weekly check-ins**: every Sunday the Today screen shows a check-in section. Log a weight, a summary of the week and up to 5 progress photos, all optional. The weight is added to your weigh-ins; past check-ins and their photos are on the Weight tab. Photos are shrunk on the phone before upload and stored privately (a Supabase storage bucket where each person can only reach their own folder).
- **Food (from Fuel8) — built but switched off in the app for now.** Turn it on by setting `food:true` in `FEATURES` near the top of the script in `src/app.html` and rebuilding (or add `features: { food: true }` to `HH_CONFIG` in `config.js`). The backend stays deployed. What it does: calories, protein, carbs and fat for each day, with a daily target, a Today card, a calories chart with the target line, 7-day averages and an estimated maintenance level (from 4 weeks of food and your weight trend). Fuel8 has no API, so the route is Fuel8 → Apple Health → an iPhone Shortcut → the `food-sync` Supabase Edge Function. Set it up in the app: **Food → Connect Fuel8** (or Settings → Food), which makes your personal sync key and walks you through the Shortcut.
- **Goals**: each weekly metric gets a target by a date. The target ramps in a straight line from where you start to the goal, so every week shows the level to hit (✓ marks weeks you hit it).

## Install on iPhone

1. Open https://steveroe21.github.io/health-hub/ in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Always open it from the Home Screen icon. It runs full-screen and works offline.

The app doesn't zoom (no pinch or double-tap zoom) and only scrolls up and down.

Your data is stored on the phone (in the app's own storage), never in this repo. Use **Settings → Save backup file** now and then.

## Brand

From the Health Hub brand board: Egyptian Blue `#0F2D52`, Stone Blue `#7A8CA3`, Scarlet Red `#C6283D`.
Display type is Archivo at its widest setting, a free stand-in for Monument Extended. Body text is Inter.
Both fonts are bundled in `fonts/` under the SIL Open Font License. App icons are rendered by `tools/make-icons.mjs`.

## Project layout

| Path | What it is |
|---|---|
| `src/app.html` | The whole app source (HTML, CSS and JS in one file, no dependencies) |
| `src/exercises.txt` | Exercise library: `Name (Equipment) | Equipment | Primary muscle | Secondary | Type` |
| `tools/build.py` | Builds the site files at the repo root, the Claude-hosted version and an install zip |
| `index.html`, `manifest.webmanifest`, `sw.js`, `icons/` | Built site files that GitHub Pages serves (don't edit by hand) |
| `supabase/functions/food-sync/` | Edge Function the iPhone Shortcut posts food totals to (`parse.js` cleans the input; shared with the tests) |
| `supabase/migrations/` | SQL applied to the Supabase project (food_days and sync_keys tables with row-level security) |
| `tools/test*.mjs` | Tests: headless-browser tests (app, Claude storage, accounts, Supabase library, workout logger, weekly check-ins, no-zoom and bodyweight volume, food) plus `test-food-parse.mjs` for the sync parser |

## Develop

```bash
python3 tools/build.py            # rebuild site files after editing src/app.html
cd tools && npm i && node test.mjs && node test-cloud.mjs   # tests (need Chrome)
```

Planned: Whoop integration.

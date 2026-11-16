# Health Hub

A personal health and weight-loss tracker that installs on iPhone as a home-screen app.

**Open it:** https://steveroe21.github.io/health-hub/

## What it does

- **Weight**: log weigh-ins and see them on a chart. Set a goal weight and a target date, and a straight goal line shows where you should be on each day. Stats include change since start, kg to go, pace needed, 7-day average, 4-week trend and the date you'd hit your goal on that trend.
- **Lifting**: log sessions (Push / Pull / Legs / custom) with total volume, or import your whole history from a Hevy CSV export. You see weekly volume totals.
- **Running**: log distance and time (pace is worked out for you). You see weekly distance totals.
- **Steps**: one total per day. You see weekly totals and the daily average you need for the rest of the week.
- **Goals**: each weekly metric gets a target by a date. The target ramps in a straight line from where you start to the goal, so every week shows the level to hit (✓ marks weeks you hit it).

## Install on iPhone

1. Open https://steveroe21.github.io/health-hub/ in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Always open it from the Home Screen icon. It runs full-screen and works offline.

Your data is stored on the phone (in the app's own storage), never in this repo. Use **Settings → Save backup file** now and then.

## Project layout

| Path | What it is |
|---|---|
| `src/app.html` | The whole app source (HTML, CSS and JS in one file, no dependencies) |
| `tools/build.py` | Builds the site files at the repo root, the Claude-hosted version and an install zip |
| `index.html`, `manifest.webmanifest`, `sw.js`, `icons/` | Built site files that GitHub Pages serves (don't edit by hand) |
| `tools/test.mjs`, `tools/test-cloud.mjs` | Headless-browser tests |

## Develop

```bash
python3 tools/build.py            # rebuild site files after editing src/app.html
cd tools && npm i && node test.mjs && node test-cloud.mjs   # tests (need Chrome)
```

Planned: Whoop and FUEL8 integration, design and colour pass.

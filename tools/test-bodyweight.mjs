// No zoom / no sideways scrolling, and body weight counted in volume for pull-ups etc.
// Needs: python3 tools/build.py
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = new URL('../dist', import.meta.url).pathname;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.woff2') ? 'font/woff2' : p.endsWith('.jpg') ? 'image/jpeg' : 'text/javascript' }); res.end(fs.readFileSync(f));
}).listen(8771);
const shots = new URL('../shots', import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' — ' + extra : '')); };
const d = k => { const x = new Date(); x.setDate(x.getDate() - k); return x.toISOString().slice(0, 10); };
const seed = {
  weights: [{ id: 'w1', date: d(10), kg: 96 }, { id: 'w2', date: d(0), kg: 95.5 }],
  lifts: [
    // saved in the app before this change: bench 60×10 counted, pull-ups counted nothing
    { id: 'a', date: d(5), name: 'Pull Day', volume: 600, sets: 4, source: 'logger', exercises: [{ n: 'Pull Up', sets: [{ r: 10 }, { r: 10 }, { r: 10 }] }, { n: 'Bench Press (Barbell)', sets: [{ w: 60, r: 10 }] }] },
    // Hevy import, warm-ups counted: weighted pull-ups counted only the added 10 kg
    { id: 'b', date: d(4), name: 'Hevy A', volume: 50, sets: 2, source: 'hevy', hevyKey: 'A|x', exercises: [{ n: 'Pull Up (Weighted)', sets: [{ t: 'w', r: 5 }, { w: 10, r: 5 }] }] },
    // Hevy import, warm-ups left out (bench warm-up 20×10 not in the 600)
    { id: 'c', date: d(3), name: 'Hevy B', volume: 600, sets: 2, source: 'hevy', hevyKey: 'B|x', exercises: [{ n: 'Bench Press (Barbell)', sets: [{ t: 'w', w: 20, r: 10 }, { w: 60, r: 10 }] }, { n: 'Chin Up', sets: [{ r: 8 }] }] },
    // assisted pull-ups (−30 kg) and a crunch, which keeps counting nothing
    { id: 'e', date: d(2), name: 'Assisted', volume: 0, sets: 2, source: 'logger', exercises: [{ n: 'Pull Up (Assisted)', sets: [{ w: 30, r: 10 }] }, { n: 'Crunch', sets: [{ r: 20 }] }] },
    { id: 'f', date: d(1), name: 'Past total', volume: 5000 },
    { id: 'g', date: d(1), name: 'Already new', volume: 1234, vr: 2, exercises: [{ n: 'Pull Up', sets: [{ r: 10 }] }] }
  ]
};

for (const vw of [320, 393]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: 760 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.HH_CONFIG = {};' }));
  await ctx.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }));
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('healthhub.v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(seed));
  await page.goto('http://localhost:8771/HealthHub/'); await page.waitForSelector('#loader', { state: 'detached' });
  const W = ms => page.waitForTimeout(ms);
  console.log(`\n--- ${vw}px wide`);

  // zoom is off
  const z = await page.evaluate(() => ({ meta: document.querySelector('meta[name=viewport]').content, html: getComputedStyle(document.documentElement).touchAction, scroll: getComputedStyle(document.querySelector('#scroll')).touchAction }));
  ok('viewport blocks zoom', /maximum-scale=1/.test(z.meta) && /user-scalable=no/.test(z.meta), z.meta);
  ok('double-tap zoom off (touch-action)', z.html === 'manipulation' && z.scroll === 'pan-y', z.html + ' / ' + z.scroll);
  const pinch = await page.evaluate(() => {
    const g = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(g);
    const t = document.createElement('div'); document.body.appendChild(t);
    const mk = id => new Touch({ identifier: id, target: t, clientX: 100 + id * 50, clientY: 300 });
    const two = new TouchEvent('touchmove', { cancelable: true, bubbles: true, touches: [mk(1), mk(2)] }); t.dispatchEvent(two);
    const one = new TouchEvent('touchmove', { cancelable: true, bubbles: true, touches: [mk(1)] }); t.dispatchEvent(one);
    t.remove(); return { gesture: g.defaultPrevented, two: two.defaultPrevented, one: one.defaultPrevented };
  });
  ok('pinch cancelled, one-finger scrolling left alone', pinch.gesture && pinch.two && !pinch.one, JSON.stringify(pinch));

  // nothing wider than the screen, nothing scrolls sideways
  const wide = async where => page.evaluate(where => {
    const out = []; const iw = innerWidth;
    document.querySelectorAll('#scroll, .sheet.open, .wk-body, .pk-list').forEach(sc => { const before = sc.scrollLeft; sc.scrollLeft = 200; if (sc.scrollLeft !== before) out.push((sc.id || sc.className) + ' scrolls sideways'); sc.scrollLeft = 0; });
    document.querySelectorAll('#app *, #wk *, .sheet.open *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.right > iw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.sheet:not(.open)')) out.push(el.tagName + '.' + el.className + ' right=' + Math.round(r.right)); });
    if (document.scrollingElement.scrollWidth > iw) out.push('page wider than screen');
    return out.slice(0, 5);
  }, where);
  for (const v of ['overview', 'weight', 'lifting', 'running', 'steps']) { await page.click(`.tab[data-go="${v}"]`); await W(150); const w = await wide(v); ok(`${v}: no sideways scroll`, !w.length, w.join(' | ')); }

  // old workouts recounted once
  const L = await page.evaluate(() => Object.fromEntries(window.__hh.state.lifts.map(l => [l.id, [l.volume, l.vr]])));
  ok('in-app pull day: 600 + 96 kg × 30 reps', L.a[0] === 3480, L.a);
  ok('Hevy weighted pull-ups: (96 + 10) × 5 + 96 × 5 warm-up', L.b[0] === 1010, L.b);
  ok('Hevy without warm-ups: 600 + 96 × 8 chin-ups', L.c[0] === 1368, L.c);
  ok('assisted: (96 − 30) × 10, crunches still 0', L.e[0] === 660, L.e);
  ok('total-only and already-updated sessions untouched', L.f[0] === 5000 && L.g[0] === 1234, L.f + ' / ' + L.g);
  ok('every workout marked as recounted', Object.values(L).every(x => x[1] === 2));

  if (vw === 393) {
    // live logger: pull-ups use the latest weigh-in (95.5 kg)
    await page.click('.tab[data-go="lifting"]'); await page.click('[data-act="startwk"]'); await page.waitForSelector('#wk');
    await page.click('#wk [data-wk="add"]'); await page.waitForSelector('#pk');
    await page.fill('#pkq', 'pull up'); await W(100); await page.click('.pk-row[data-name="Pull Up"]');
    await page.fill('#pkq', 'bench bar'); await W(100); await page.click('.pk-row[data-name="Bench Press (Barbell)"]');
    await page.click('[data-pk="add"]'); await W(200);
    const card = i => `#wk .exc[data-ei="${i}"]`;
    ok('pull-up card shows body weight', /95\.5 kg/.test(await page.textContent(`${card(0)} .exc-bw`)), await page.textContent(`${card(0)} .exc-bw`));
    ok('bench card has no body-weight note', !(await page.$(`${card(1)} .exc-bw`)));
    await page.fill(`${card(0)} .set-row[data-si="0"] [data-f="r"]`, '10'); await page.click(`${card(0)} .set-row[data-si="0"] [data-wk="check"]`); await W(150);
    ok('ticking 10 pull-ups adds 955 kg', (await page.textContent('#wkVol')).trim() === '955 kg', await page.textContent('#wkVol'));
    await page.fill(`${card(1)} .set-row[data-si="0"] [data-f="w"]`, '60'); await page.fill(`${card(1)} .set-row[data-si="0"] [data-f="r"]`, '10'); await page.click(`${card(1)} .set-row[data-si="0"] [data-wk="check"]`); await W(150);
    ok('plus bench 60 × 10 = 1,555 kg', (await page.textContent('#wkVol')).trim() === '1,555 kg', await page.textContent('#wkVol'));
    const lw = await wide('logger'); ok('logger: no sideways scroll', !lw.length, lw.join(' | '));
    await page.screenshot({ path: shots + '/bodyweight-logger.png' });
    // double-tap on a tick button still just toggles (no zoom, both taps land)
    const scaleBefore = await page.evaluate(() => visualViewport.scale);
    await page.tap(`${card(1)} .set-row[data-si="0"] [data-wk="check"]`); await page.tap(`${card(1)} .set-row[data-si="0"] [data-wk="check"]`); await W(200);
    ok('double-tap on tick: no zoom, set still ticked', (await page.evaluate(() => visualViewport.scale)) === scaleBefore && await page.$(`${card(1)} .set-row[data-si="0"].done`) !== null);
    await page.click('#wk [data-wk="finish"]'); await page.waitForSelector('.sheet.open form'); await W(300);
    ok('save sheet shows 1,555 kg', /1,555 kg/.test(await page.textContent('.sheet .calc')));
    await page.click('.sheet button[type=submit]'); await W(500);
    const saved = await page.evaluate(() => window.__hh.state.lifts.find(l => l.source === 'logger' && l.exercises && l.exercises.length === 2 && l.exercises[0].n === 'Pull Up' && l.exercises[0].sets.length === 1));
    ok('saved workout volume 1,555 and marked', saved && saved.volume === 1555 && saved.vr === 2, saved && [saved.volume, saved.vr]);
    await page.reload(); await page.waitForSelector('#loader', { state: 'detached' });
    const after = await page.evaluate(() => window.__hh.state.lifts.find(l => l.id === 'a').volume);
    ok('recount does not stack on reload', after === 3480, after);
  }
  ok('no page errors', !errors.length, errors.join(' | '));
  await ctx.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
await browser.close(); srv.close(); process.exit(fails ? 1 : 0);

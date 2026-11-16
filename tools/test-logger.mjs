import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = new URL('../dist', import.meta.url).pathname;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); res.end(fs.readFileSync(f));
}).listen(8769);
const shots = new URL('../shots', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.HH_CONFIG = {};' }));   // local mode
await ctx.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }));
const errors = []; const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
const st = () => page.evaluate(() => window.__hh.state);
await page.goto('http://localhost:8769/HealthHub/#lifting'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForSelector('#loader', { state: 'detached' });
await page.screenshot({ path: shots + '/lifting-empty.png' });

// 1. start empty workout, add two exercises via search + muscle filter
await page.click('[data-act="startwk"]'); await page.waitForSelector('#wk');
await page.screenshot({ path: shots + '/logger-empty.png' });
await page.click('#wk [data-wk="add"]'); await page.waitForSelector('#pk');
console.log('picker count label:', await page.getAttribute('#pkq', 'placeholder'));
await page.fill('#pkq', 'bench bar'); await W(100);
console.log('search "bench bar":', await page.$$eval('.pk-row .n', els => els.map(e => e.textContent)));
await page.click('.pk-row[data-name="Bench Press (Barbell)"]');
await page.fill('#pkq', ''); await page.selectOption('#pkmu', 'Lats'); await W(100);
const latsCount = await page.$$eval('.pk-row', els => els.length);
await page.click('.pk-row[data-name="Lat Pulldown (Cable)"]');
await page.screenshot({ path: shots + '/picker.png' });
console.log('lats filter results:', latsCount, '| footer:', await page.textContent('#pkf'));
await page.click('[data-pk="add"]'); await W(200);
console.log('cards:', await page.$$eval('#wk .exc .exc-name span:last-child', els => els.map(e => e.textContent)));

// 2. log sets
const card = i => `#wk .exc[data-ei="${i}"]`;
await page.fill(`${card(0)} .set-row[data-si="0"] [data-f="w"]`, '60'); await page.fill(`${card(0)} .set-row[data-si="0"] [data-f="r"]`, '10');
await page.click(`${card(0)} .set-row[data-si="0"] [data-wk="check"]`); await W(150);
console.log('rest bar shown:', await page.isVisible('#restBar'), await page.textContent('#restT'));
await page.click(`${card(0)} [data-wk="addset"]`);
await page.fill(`${card(0)} .set-row[data-si="1"] [data-f="w"]`, '65'); await page.fill(`${card(0)} .set-row[data-si="1"] [data-f="r"]`, '8');
await page.click(`${card(0)} .set-row[data-si="1"] [data-wk="check"]`);
await page.fill(`${card(1)} .set-row[data-si="0"] [data-f="w"]`, '50'); await page.fill(`${card(1)} .set-row[data-si="0"] [data-f="r"]`, '12');
await page.click(`${card(1)} .set-row[data-si="0"] [data-wk="check"]`);
// empty set tick -> error toast
await page.click(`${card(1)} [data-wk="addset"]`); await page.click(`${card(1)} .set-row[data-si="1"] [data-wk="check"]`); await W(100);
console.log('empty tick toast:', await page.textContent('#toast'));
// mark first bench set as warm-up
await page.click(`${card(0)} .set-row[data-si="0"] [data-wk="settype"]`); await page.waitForSelector('.sheet.open'); await page.click('.sheet [data-o="0"]'); await W(400);
console.log('set labels:', await page.$$eval(`${card(0)} .set-no`, els => els.map(e => e.textContent)));
console.log('stats:', await page.textContent('#wkVol'), '|', await page.textContent('#wkSets'));
await page.screenshot({ path: shots + '/logger-sets.png' });

// 3. minimise + reload -> resume
await page.click('#wk [data-wk="min"]'); await W(150);
console.log('resume bar:', (await page.textContent('#resume')).replace(/\s+/g, ' '));
await page.screenshot({ path: shots + '/resume-bar.png' });
await page.reload(); await page.waitForSelector('#loader', { state: 'detached' }); await W(300);
console.log('resume after reload:', await page.isVisible('#resume'));
await page.click('#resume'); await page.waitForSelector('#wk');
console.log('restored sets done:', await page.$$eval('#wk .set-row.done', els => els.length));

// 4. finish with an unticked filled set
await page.fill(`${card(1)} .set-row[data-si="1"] [data-f="r"]`, '10');
await page.click('#wk [data-wk="finish"]'); await page.waitForSelector('.sheet.open');
console.log('unticked prompt:', await page.textContent('.sheet-head h2'));
await page.click('.sheet [data-drop]'); await W(500); await page.waitForSelector('.sheet.open form');
await page.fill('.sheet input[name=title]', 'Push Day');
await page.screenshot({ path: shots + '/save-sheet.png' });
await page.click('.sheet button[type=submit]'); await W(500);
let s = await st(); const l1 = s.lifts.at(-1);
console.log('saved:', l1.name, l1.volume, 'kg', l1.sets, 'sets', JSON.stringify(l1.exercises));
console.log('logger closed:', !(await page.$('#wk')), '| resume gone:', !(await page.$('#resume')), '| active key gone:', await page.evaluate(() => !Object.keys(localStorage).some(k => k.includes('.active.'))));

// 5. next workout: previous + placeholder + PR
await page.click('[data-act="startwk"]'); await page.click('#wk [data-wk="add"]'); await page.fill('#pkq', 'bench press (barbell)');
await page.click('.pk-row[data-name="Bench Press (Barbell)"]'); await page.click('[data-pk="add"]'); await W(200);
console.log('rows prefilled from history:', await page.$$eval(`${card(0)} .set-row:not(.hd)`, els => els.length), '| previous:', await page.$$eval(`${card(0)} .set-prev`, els => els.map(e => e.textContent)));
console.log('placeholders:', await page.$$eval(`${card(0)} .set-row[data-si="1"] .set-in`, els => els.map(e => e.placeholder)));
await page.click(`${card(0)} .set-row[data-si="0"] [data-wk="check"]`);
await page.fill(`${card(0)} .set-row[data-si="1"] [data-f="w"]`, '70'); await page.click(`${card(0)} .set-row[data-si="1"] [data-wk="check"]`);
await page.click('#wk [data-wk="finish"]'); await page.waitForSelector('.sheet.open form'); await W(300);
console.log('PR text:', (await page.textContent('.sheet .calc')).replace(/\s+/g, ' '));
await page.click('.sheet button[type=submit]'); await W(500);
console.log('toast:', await page.textContent('#toast'));
s = await st(); console.log('2nd workout sets:', JSON.stringify(s.lifts.at(-1).exercises[0].sets));

// 6. routine
await page.click('[data-act="newroutine"]'); await page.waitForSelector('#wk');
await page.fill('#wk .rt-title', 'Pull Day');
await page.click('#wk [data-wk="add"]'); await page.fill('#pkq', 'pulldown cable'); await page.click('.pk-row[data-name="Lat Pulldown (Cable)"]');
await page.fill('#pkq', 'face pull'); await page.click('.pk-row[data-name="Face Pull (Cable)"]'); await page.click('[data-pk="add"]'); await W(200);
await page.fill(`${card(0)} .set-row[data-si="0"] [data-f="w"]`, '55'); await page.fill(`${card(0)} .set-row[data-si="0"] [data-f="r"]`, '10');
await page.screenshot({ path: shots + '/routine-editor.png' });
await page.click('#wk [data-wk="finish"]'); await W(400);
s = await st(); console.log('routine:', JSON.stringify(s.routines.map(r => ({ name: r.name, ex: r.exercises.map(x => x.n + ':' + x.sets.length), first: r.exercises[0].sets[0] }))));
await page.screenshot({ path: shots + '/lifting-routines.png' });
await page.click('[data-act="startroutine"]'); await page.waitForSelector('#wk');
console.log('routine started title:', await page.textContent('#wk .wk-title'), '| ph:', await page.$$eval(`${card(0)} .set-row[data-si="0"] .set-in`, els => els.map(e => e.placeholder)));
await page.click('#wk [data-wk="discard"]'); await page.click('#wk [data-wk="discard"]'); await W(300);
console.log('discarded:', !(await page.$('#wk')));

// 7. workout detail + edit
await page.click('.list .item >> nth=0'); await page.waitForSelector('.sheet.open'); await W(300);
await page.screenshot({ path: shots + '/workout-detail.png' });
await page.click('.sheet [data-edit]'); await page.waitForSelector('#wk'); await W(200);
console.log('edit mode title:', await page.textContent('#wk .wk-title'), '| done rows:', await page.$$eval('#wk .set-row.done', els => els.length));
await page.fill(`${card(0)} .set-row[data-si="1"] [data-f="r"]`, '9');
await page.click('#wk [data-wk="finish"]'); await page.waitForSelector('.sheet.open form'); await page.click('.sheet button[type=submit]'); await W(500);
s = await st(); console.log('edited lifts count:', s.lifts.length, '| edited set:', JSON.stringify(s.lifts.at(-1).exercises[0].sets[1]), '| volume', s.lifts.at(-1).volume);

// 8. Hevy import keeps sets, then shows as "previous"
const csv = ['title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe',
 '"Pull Day","10 Nov 2026, 18:05","10 Nov 2026, 19:12","","Lat Pulldown (Cable)",,"",0,warmup,30,12,,,',
 '"Pull Day","10 Nov 2026, 18:05","10 Nov 2026, 19:12","","Lat Pulldown (Cable)",,"",1,normal,60,10,,,',
 '"Pull Day","10 Nov 2026, 18:05","10 Nov 2026, 19:12","","Plank",,"",0,normal,,,,60,',
 '"Pull Day","10 Nov 2026, 18:05","10 Nov 2026, 19:12","","Seated Cable Row - V Grip (Cable)",,"",0,normal,55,12,,,'].join('\n');
fs.writeFileSync('/tmp/hevy2.csv', csv);
await page.click('[data-act="hevy"]'); await page.setInputFiles('.sheet input[name=file]', '/tmp/hevy2.csv'); await page.waitForSelector('[data-go-import]'); await page.click('[data-go-import]'); await W(400);
s = await st(); const hv = s.lifts.find(l => l.source === 'hevy');
console.log('hevy import:', hv.volume, JSON.stringify(hv.exercises));
await page.click('[data-act="startwk"]'); await page.click('#wk [data-wk="add"]'); await page.fill('#pkq', 'v grip'); await W(100);
console.log('hevy-only exercise in picker:', await page.$$eval('.pk-row .n', els => els.map(e => e.textContent)));
await page.click('.pk-row[data-name="Seated Cable Row - V Grip (Cable)"]'); await page.fill('#pkq', 'plank'); await page.click('.pk-row[data-name="Plank"]'); await page.click('[data-pk="add"]'); await W(200);
console.log('previous from hevy:', await page.$$eval('#wk .set-prev', els => els.map(e => e.textContent)));
console.log('plank columns:', await page.$$eval(`${card(1)} .set-row.hd div`, els => els.map(e => e.textContent)));

// 9. custom exercise + info sheet
await page.click('#wk [data-wk="add"]'); await page.fill('#pkq', 'Zercher Carry'); await W(100);
await page.click('#pk [data-pk="create"]'); await page.waitForSelector('.sheet.open form');
await page.selectOption('.sheet select[name=t]', 'wdur'); await page.click('.sheet button[type=submit]'); await W(400);
console.log('custom selected:', await page.textContent('#pkf'));
await page.click('[data-pk="add"]'); await W(200);
console.log('custom card cols:', await page.$$eval(`${card(2)} .set-row.hd div`, els => els.map(e => e.textContent)));
await page.click('#wk [data-wk="discard"]'); await page.click('#wk [data-wk="discard"]'); await W(300);
await page.click('.tab[data-go="overview"]'); await page.click('[data-act="add"][data-kind="lift"]'); await page.waitForSelector('.sheet.open'); await W(300);
await page.screenshot({ path: shots + '/lift-chooser.png' });
console.log('chooser options:', await page.$$eval('.sheet .btn', els => els.map(e => e.textContent.trim())));
await page.click('.sheet [data-close]'); await W(300);
await page.click('.tab[data-go="lifting"]'); await page.click('.list .item >> nth=0'); await page.waitForSelector('.sheet.open'); await page.click('.sheet [data-exinfo] >> nth=0'); await W(400);
await page.screenshot({ path: shots + '/exercise-info.png' });
console.log('info stats:', await page.$$eval('.sheet .stat .k', els => els.map(e => e.textContent)));
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); srv.close();

import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const root = new URL('../dist', import.meta.url).pathname;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(f);
  res.writeHead(200, {'content-type': {'.html':'text/html','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'}[ext] || 'text/plain'});
  res.end(fs.readFileSync(f));
}).listen(8765);

const shots = new URL('../shots', import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];

// ---- seed realistic data relative to today
function seed() {
  const pad = n => String(n).padStart(2, '0');
  const ds = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const day = k => { const d = new Date(); d.setDate(d.getDate() - k); return ds(d); };
  const s = { v:1, weights:[], lifts:[], runs:[], steps:[], goals:{}, prefs:{ weekStart:1 } };
  let w = 92.4, id = 0;
  for (let k = 49; k >= 0; k -= (k % 3 === 0 ? 2 : 1)) { w += -0.11 + Math.sin(k*1.7)*0.35; s.weights.push({ id:'w'+(id++), date:day(k), kg: Math.round(w*10)/10 }); w -= 0.05; }
  const names = ['Push','Pull','Legs'];
  for (let k = 55; k >= 0; k -= 2) { if (k % 7 === 6) continue; s.lifts.push({ id:'l'+(id++), date:day(k), name:names[k%3], volume: 6500 + ((55-k)*60) + (k%3)*900, durationMin: 60 + k%20 }); }
  for (let k = 54; k >= 1; k -= 3) s.runs.push({ id:'r'+(id++), date:day(k), km: Math.round((4 + (k%5) + (54-k)*0.05)*10)/10, durationMin: 28 + k%9 });
  for (let k = 60; k >= 1; k--) s.steps.push({ id:'s'+(id++), date:day(k), steps: 7000 + ((k*977) % 6000) });
  s.goals.weight = { startDate: day(49), startKg: 92.3, targetKg: 82, targetDate: day(-70) };
  s.goals.volume = { startDate: day(28), startValue: 22000, target: 32000, targetDate: day(-42) };
  s.goals.distance = { startDate: day(28), startValue: 12, target: 25, targetDate: day(-56) };
  s.goals.steps = { startDate: day(14), startValue: 60000, target: 70000, targetDate: day(-28) };
  return s;
}
const seeded = seed();

await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.HH_CONFIG = {};' }));  // on-device mode
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('healthhub.v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, seeded);
await page.goto('http://localhost:8765/HealthHub/');
await page.waitForSelector('#loader', { state: 'detached' });

for (const v of ['overview', 'weight', 'lifting', 'running', 'steps']) {
  await page.click(`.tab[data-go="${v}"]`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${shots}/${v}.png`, fullPage: v !== 'overview' });
}
// tooltip on weight chart
await page.click('.tab[data-go="weight"]');
const box = await page.locator('#chart-weight svg').boundingBox();
await page.mouse.move(box.x + box.width*0.6, box.y + box.height/2);
await page.waitForTimeout(100);
await page.screenshot({ path: `${shots}/weight-tip.png`, clip: { x: 0, y: box.y - 120, width: 390, height: box.height + 160 } });
// range buttons
for (const r of ['1m','3m','all','goal']) { await page.click(`[data-act="range"][data-key="weight"][data-val="${r}"]`); }
await page.screenshot({ path: `${shots}/weight-goal-range.png`, clip: { x: 0, y: box.y - 60, width: 390, height: box.height + 80 } });

// log weight via the sheet
const before = await page.evaluate(() => window.__hh.state.weights.length);
await page.click('[data-act="add"][data-kind="weight"]');
await page.waitForSelector('.sheet.open');
await page.fill('.sheet input[name=kg]', '86,4');
await page.screenshot({ path: `${shots}/sheet-weight.png` });
await page.click('.sheet button[type=submit]');
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({ n: window.__hh.state.weights.length, last: window.__hh.state.weights.at(-1) }));
console.log('weight add:', before, '->', after.n, after.last);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('healthhub.v1')).weights.length);
console.log('persisted weights:', stored);

// weekly goal sheet
await page.click('.tab[data-go="lifting"]');
await page.click('[data-act="goal"][data-kind="volume"]');
await page.waitForSelector('.sheet.open');
await page.waitForTimeout(300);
await page.screenshot({ path: `${shots}/sheet-goal.png` });
await page.click('.sheet [data-close]'); await page.waitForTimeout(300);

// lifting log
await page.click('[data-act="add"][data-kind="liftpast"]');
await page.waitForSelector('.sheet.open');
await page.click('.sheet [data-chip="Pull"]');
await page.fill('.sheet input[name=volume]', '8,450');
await page.fill('.sheet input[name=dur]', '72');
await page.screenshot({ path: `${shots}/sheet-lift.png` });
await page.click('.sheet button[type=submit]'); await page.waitForTimeout(400);
console.log('last lift:', await page.evaluate(() => window.__hh.state.lifts.at(-1)));

// run log with time
await page.click('.tab[data-go="running"]');
await page.click('[data-act="add"][data-kind="run"]');
await page.fill('.sheet input[name=km]', '5.2'); await page.fill('.sheet input[name=time]', '27:35');
console.log('pace text:', await page.textContent('.sheet [data-pace]'));
await page.click('.sheet button[type=submit]'); await page.waitForTimeout(400);

// steps: same-day replacement
await page.click('.tab[data-go="steps"]');
for (const n of ['9,800', '12,345']) {
  await page.click('[data-act="add"][data-kind="steps"]');
  await page.fill('.sheet input[name=steps]', n);
  await page.click('.sheet button[type=submit]'); await page.waitForTimeout(400);
}
console.log('steps today:', await page.evaluate(() => { const t = window.__hh.state.steps.filter(s => s.date === window.__hh.state.steps.at(-1).date); return t.map(x => x.steps); }));

// Hevy import
const csv = [
 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe',
 '"Pull Day","10 Nov 2026, 18:05","10 Nov 2026, 19:12","","Lat Pulldown (Cable)",,"",0,warmup,30,12,,,',
 '"Pull Day","10 Nov 2026, 18:05","10 Nov 2026, 19:12","","Lat Pulldown (Cable)",,"",1,normal,60,10,,,',
 '"Pull Day","10 Nov 2026, 18:05","10 Nov 2026, 19:12","","Lat Pulldown (Cable)",,"felt strong, ""PR""",2,normal,65,8,,,8',
 '"Pull Day","10 Nov 2026, 18:05","10 Nov 2026, 19:12","","Pull Up",,"",0,normal,,10,,,',
 '"Push Day","12 Nov 2026, 07:30","12 Nov 2026, 08:31","line one\nline two","Bench Press (Barbell)",,"",0,normal,80,8,,,',
 '"Push Day","12 Nov 2026, 07:30","12 Nov 2026, 08:31","line one\nline two","Bench Press (Barbell)",,"",1,normal,80,7,,,',
].join('\n');
fs.writeFileSync('/tmp/hevy.csv', csv);
await page.click('.tab[data-go="lifting"]');
await page.click('[data-act="hevy"]');
await page.setInputFiles('.sheet input[name=file]', '/tmp/hevy.csv');
await page.waitForSelector('[data-go-import]');
await page.screenshot({ path: `${shots}/sheet-hevy.png` });
console.log('hevy preview:', (await page.textContent('.sheet .calc')).trim());
await page.uncheck('.sheet input[name=skipManual]'); await page.waitForTimeout(100);
console.log('hevy preview (no skip):', (await page.textContent('.sheet .calc')).trim());
await page.click('[data-go-import]'); await page.waitForTimeout(400);
console.log('hevy lifts:', await page.evaluate(() => window.__hh.state.lifts.filter(l => l.source === 'hevy')));
// re-import => nothing new
await page.click('[data-act="hevy"]');
await page.setInputFiles('.sheet input[name=file]', '/tmp/hevy.csv');
await page.waitForSelector('[data-go-import]');
console.log('re-import:', (await page.textContent('[data-go-import]')).trim());
await page.click('.sheet [data-close]'); await page.waitForTimeout(300);

// date parser checks
console.log('dates:', await page.evaluate(() => ['17 Mar 2024, 07:12', '2024-03-17 19:05:00', 'Mar 17, 2024, 7:12 PM', '3 Sept 2025, 6:00', '17/03/2024 07:12'].map(s => (window.__hh.parseLooseDateTime(s) || {}).date)));
console.log('weekStatus volume:', await page.evaluate(() => { const r = window.__hh.weekStatus('volume'); return { sum: r.cur.sum, req: Math.round(r.req), status: r.status, daysLeft: r.daysLeft }; }));
console.log('weightStatus:', await page.evaluate(() => { const r = window.__hh.weightStatus(); return { last: r.last.kg, line: r.lineAtLast.toFixed(2), status: r.status, needRate: r.needRate && r.needRate.toFixed(2), projected: r.projected }; }));

// edit + delete flow
await page.click('.tab[data-go="weight"]');
const n0 = await page.evaluate(() => window.__hh.state.weights.length);
await page.click('.list .item >> nth=0');
await page.waitForSelector('.sheet.open');
await page.click('.sheet [data-del]'); await page.click('.sheet [data-del]'); await page.waitForTimeout(400);
console.log('delete:', n0, '->', await page.evaluate(() => window.__hh.state.weights.length));

// settings
await page.click('[data-act="settings"]'); await page.waitForTimeout(300);
await page.screenshot({ path: `${shots}/settings.png` });
await page.click('.sheet [data-close]'); await page.waitForTimeout(300);

// empty state (fresh user)
const p2 = await ctx.newPage();
p2.on('pageerror', e => errors.push('p2 pageerror: ' + e.message));
await p2.addInitScript(() => localStorage.clear());
await p2.goto('http://localhost:8765/HealthHub/#weight');
await p2.waitForSelector('#loader', { state: 'detached' });
await p2.screenshot({ path: `${shots}/empty-weight.png` });
await p2.click('.tab[data-go="overview"]'); await p2.screenshot({ path: `${shots}/empty-overview.png` });
await p2.click('.tab[data-go="lifting"]'); await p2.screenshot({ path: `${shots}/empty-lifting.png` });

console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); srv.close();

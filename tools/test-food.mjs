// Food from Fuel8: hidden by default (FEATURES.food = false). Part 0 checks nothing food-related shows or loads;
// the rest switches it on (window.HH_FEATURES) and tests sync key, Shortcut → food-sync (real parser), Today card, Food page, chart, targets.
// Needs: python3 tools/build.py
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { parsePayload, sha256hex } from '../supabase/functions/food-sync/parse.js';
const root = new URL('../dist', import.meta.url).pathname;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.woff2') ? 'font/woff2' : 'text/javascript' }); res.end(fs.readFileSync(f));
}).listen(8773);
const shots = new URL('../shots', import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };

// Mock Supabase with per-table query builders and row-level security by signed-in user
const MOCK = `window.supabase = { createClient(url, key, opts) {
  const SK = opts.auth.storageKey;
  const srv = () => JSON.parse(localStorage.getItem('mock.server') || '{"users":[],"rows":[],"food":[],"keys":[]}');
  const save = s => localStorage.setItem('mock.server', JSON.stringify(s));
  const L = []; const emit = (e, s) => L.forEach(f => f(e, s));
  const sess = () => JSON.parse(localStorage.getItem(SK) || 'null');
  const delay = () => new Promise(r => setTimeout(r, 30));
  const off = () => window.__mockOffline === true; const NE = { message: 'TypeError: Failed to fetch' };
  const login = u => { const { password, ...user } = u; const s = { user, access_token: 't' }; localStorage.setItem(SK, JSON.stringify(s)); emit('SIGNED_IN', s); return s; };
  const tables = { health_data: 'rows', food_days: 'food', sync_keys: 'keys' };
  function builder(table) {
    const q = { op: 'select', filters: [], order: null, limit: null };
    const run = async () => {
      await delay(); if (off()) return { data: null, error: NE };
      const c = sess(); if (!c) return { data: null, error: { message: 'JWT required' } };
      const s = srv(), list = s[tables[table]], uid = c.user.id;
      if (q.op === 'select') {
        let out = list.filter(r => r.user_id === uid && q.filters.every(([k, v]) => r[k] === v));
        if (q.order) out.sort((a, b) => (a[q.order.col] < b[q.order.col] ? -1 : 1) * (q.order.asc ? 1 : -1));
        if (q.limit) out = out.slice(0, q.limit);
        if (table === 'health_data') out = out.map(r => ({ key: r.key, data: r.data }));
        return { data: out, error: null };
      }
      if (q.op === 'delete') {
        if (table === 'health_data') return { error: { message: 'not allowed' } };
        s[tables[table]] = list.filter(r => !(r.user_id === uid && q.filters.every(([k, v]) => r[k] === v))); save(s); return { error: null };
      }
      if (q.op === 'upsert') {
        if (table === 'food_days') return { error: { message: 'permission denied for table food_days' } };   // only the Edge Function writes food
        const row = q.row; if (row.user_id !== uid) return { error: { message: 'new row violates row-level security policy' } };
        const keyCols = table === 'sync_keys' ? ['user_id'] : ['user_id', 'key'];
        const i = list.findIndex(r => keyCols.every(k => r[k] === row[k])); if (i >= 0) list[i] = row; else list.push(row); save(s); return { error: null };
      }
    };
    const b = {
      select() { q.op = 'select'; return b; }, order(col, o) { q.order = { col, asc: !o || o.ascending !== false }; return b; }, limit(n) { q.limit = n; return b; },
      eq(k, v) { q.filters.push([k, v]); return b; }, delete() { q.op = 'delete'; return b; },
      upsert(row) { q.op = 'upsert'; q.row = row; return b; },
      then(res, rej) { return run().then(res, rej); }
    };
    return b;
  }
  return {
    auth: {
      async getSession() { return { data: { session: sess() }, error: null }; },
      onAuthStateChange(cb) { L.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signUp({ email, password, options }) { await delay(); const s = srv();
        const u = { id: 'uid-' + (s.users.length + 1), email, password, user_metadata: options.data }; s.users.push(u); save(s); const ss = login(u); return { data: { user: ss.user, session: ss }, error: null }; },
      async signInWithPassword({ email, password }) { await delay(); const u = srv().users.find(u => u.email === email && u.password === password);
        if (!u) return { data: {}, error: { message: 'Invalid login credentials' } }; const ss = login(u); return { data: { user: ss.user, session: ss }, error: null }; },
      async signOut() { localStorage.removeItem(SK); emit('SIGNED_OUT', null); return { error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async updateUser() { return { data: {}, error: null }; }
    },
    from(t) { if (t !== 'health_data') window.__foodCalls = (window.__foodCalls || 0) + 1; return builder(t); }
  };
} };`;

const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const daysAgo = k => { const x = new Date(); x.setDate(x.getDate() - k); return ymd(x); };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const shortcutDate = () => { const x = new Date(); return x.getDate() + ' ' + MON[x.getMonth()] + ' ' + x.getFullYear() + ' at ' + pad(x.getHours()) + ':' + pad(x.getMinutes()); };

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const route = async c => {
  await c.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.HH_CONFIG = { supabaseUrl: 'https://tldbofbnqdloddgivktk.supabase.co', supabaseKey: 'pk' };" }));
  await c.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  await c.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }));
};

// 0. default build: Food is switched off and invisible
{
  const c0 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); await route(c0);
  const p0 = await c0.newPage(); const e0 = []; p0.on('pageerror', e => e0.push(e.message));
  await p0.goto('http://localhost:8773/HealthHub/'); await p0.waitForSelector('#auth form');
  await p0.click('#auth [data-mode=signup]'); await p0.fill('#auth input[name=name]', 'Stephen'); await p0.fill('#auth input[name=email]', 's@example.com'); await p0.fill('#auth input[name=password]', 'secret123');
  await p0.click('#auth button[type=submit]'); await p0.waitForSelector('#auth', { state: 'detached' }); await p0.waitForTimeout(600);
  ok('off: 5 visible tabs, no Food', (await p0.$$eval('.tab', t => t.filter(x => x.offsetParent !== null).map(x => x.getAttribute('data-go')).join(','))) === 'overview,weight,lifting,running,steps');
  ok('off: no food card or prompt on Today', !/Fuel8|Food today/.test(await p0.textContent('main')));
  await p0.evaluate(() => { location.hash = 'food'; }); await p0.waitForTimeout(200);
  ok('off: #food link goes nowhere', (await p0.textContent('#title')).startsWith('Welcome'));
  await p0.click('[data-act="settings"]'); await p0.waitForTimeout(300);
  ok('off: no Food section in Settings', !/Daily targets|Fuel8/.test(await p0.textContent('.sheet')));
  ok('off: no food or sync-key requests', !(await p0.evaluate(() => window.__foodCalls)));
  ok('off: no page errors', e0.length === 0, e0);
  await p0.screenshot({ path: shots + '/food-off.png' });
  await c0.close();
}

const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await route(ctx);
await ctx.addInitScript(() => { window.HH_FEATURES = { food: true }; });     // switch the hidden feature on for the rest
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8773' });
const errors = []; const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
const server = () => page.evaluate(() => JSON.parse(localStorage.getItem('mock.server')));
const putServer = s => page.evaluate(s => localStorage.setItem('mock.server', JSON.stringify(s)), s);
const tap = sel => page.locator(sel).first().click();

// what the food-sync Edge Function does with a Shortcut request (same parser, same hash)
async function shortcutPost(body) {
  const s = await server(); const p = parsePayload(body, {});
  const hash = await sha256hex(p.key); const k = s.keys.find(x => x.key_hash === hash);
  if (!k) return { status: 401 };
  for (const d of p.days) {
    const row = { user_id: k.user_id, date: d.date, kcal: d.kcal, protein_g: d.protein_g, carbs_g: d.carbs_g, fat_g: d.fat_g, source: 'fuel8', updated_at: new Date().toISOString() };
    const i = s.food.findIndex(r => r.user_id === row.user_id && r.date === row.date); if (i >= 0) s.food[i] = row; else s.food.push(row);
  }
  k.last_used_at = new Date().toISOString(); await putServer(s);
  return { status: 200, saved: p.days.length };
}

await page.goto('http://localhost:8773/HealthHub/');
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('#auth form');
await tap('#auth [data-mode=signup]');
await page.fill('#auth input[name=name]', 'Stephen'); await page.fill('#auth input[name=email]', 'stephen@example.com'); await page.fill('#auth input[name=password]', 'secret123');
await tap('#auth button[type=submit]'); await page.waitForSelector('#auth', { state: 'detached' }); await W(500);

// 1. before connecting
ok('6 tabs with Food second after Weight', (await page.$$eval('.tab', t => t.map(x => x.getAttribute('data-go')).join(','))) === 'overview,weight,food,lifting,running,steps');
ok('Today shows a "Track food from Fuel8" prompt', (await page.textContent('main')).includes('Track food from Fuel8'));
await page.screenshot({ path: shots + '/food-today-cta.png' });
await tap('.tab[data-go="food"]'); await W(250);
ok('Food page title', (await page.textContent('#title')).startsWith('Food'));
ok('Food page: not connected, empty chart message', (await page.textContent('main')).includes('Not connected') && (await page.textContent('#chart-food')).includes('once Fuel8 syncs'));

// 2. make a sync key
await tap('main [data-act="fuel8"]'); await W(400);
await page.screenshot({ path: shots + '/food-connect-sheet.png', fullPage: false });
ok('connect sheet shows the food-sync address', (await page.textContent('.sheet [data-url]')).trim() === 'https://tldbofbnqdloddgivktk.supabase.co/functions/v1/food-sync');
await tap('.sheet [data-newkey]'); await W(900);
const key = (await page.textContent('.sheet [data-keyval]')).trim();
ok('key shown once, right format', /^hh_[A-Za-z0-9_-]{43}$/.test(key), key.slice(0, 8) + '…');
let s = await server();
ok('server stores only the SHA-256 hash and last 4', s.keys.length === 1 && s.keys[0].key_hash === await sha256hex(key) && s.keys[0].hint === key.slice(-4) && !JSON.stringify(s).includes(key));
await tap('.sheet [data-copy-key]'); await W(200);
ok('Copy puts the key on the clipboard', (await page.evaluate(() => navigator.clipboard.readText())) === key);
await page.screenshot({ path: shots + '/food-key.png' });

// 3. Shortcut runs: today's totals in the default Shortcuts date format, plus 3 weeks of history; weigh-ins trending down
const hist = [];
for (let k = 1; k <= 21; k++) hist.push({ date: daysAgo(k), kcal: 1900 + (k % 5) * 60, protein: 150 + (k % 4) * 8, carbs: 190, fat: 65 });
ok('wrong key rejected', (await shortcutPost({ key: 'hh_' + 'x'.repeat(43), kcal: 1 })).status === 401);
ok('history accepted', (await shortcutPost({ key, days: hist })).saved === 21);
ok('today accepted', (await shortcutPost({ key, date: shortcutDate(), kcal: '1,850.4', protein: 160.2, carbs: 180, fat: '62' })).saved === 1);
s = await server(); s.rows.push({ user_id: 'uid-1', key: 'weights', data: { entries: [0, 6, 13, 20, 27].map((k, i) => ({ id: 'w' + i, date: daysAgo(k), kg: 92.0 + k * 0.08 })) } }); await putServer(s);
await tap('.sheet [data-check]'); await W(700);
ok('"Check" toast reports today', /1,850 kcal · 160 g protein/.test(await page.textContent('#toast')), await page.textContent('#toast'));
await page.click('.sheet [data-close]'); await W(350);
await page.evaluate(() => window.dispatchEvent(new Event('online'))); await W(500);   // pulls health rows too (weigh-ins)

let main = await page.textContent('main');
ok('Food page today: 1,850 kcal', main.includes('1,850') && main.includes('No daily calorie target set'));
ok('macro tiles', /Protein160 g/.test(main.replace(/\s+/g, '')) || main.includes('160 g'), main.match(/Protein.{0,20}/)?.[0]);
ok('Fuel8 card connected with last sync', main.includes('Connected') && /Last sync today at \d\d:\d\d/.test(main));
ok('chart has 22 bars (21 days + today) in 4W', (await page.$$('#chart-food path')).length === 22, (await page.$$('#chart-food path')).length);
ok('7-day average from the last 7 full days', main.includes('7-day average') && /2,0\d\d kcal|1,9\d\d kcal/.test(main));
const est = main.match(/≈\s?([\d,]+) kcal/);
ok('estimated maintenance shown and plausible', est && +est[1].replace(',', '') > 2000 && +est[1].replace(',', '') < 3500, est && est[0]);
ok('history list: today first with macros', (await page.textContent('main .list .item >> nth=0')).includes('Today') && (await page.textContent('main .list .item >> nth=0')).includes('Protein 160 g'));
await page.screenshot({ path: shots + '/food-page.png', fullPage: true });

// 4. targets
await tap('main [data-act="foodtargets"]'); await W(350);
await page.fill('.sheet input[name=kcal]', '300'); await tap('.sheet button[type=submit]');
ok('silly calorie target refused', (await page.textContent('.sheet .err')).includes('between 800'));
await page.fill('.sheet input[name=kcal]', '2,000'); await page.fill('.sheet input[name=protein]', '170'); await tap('.sheet button[type=submit]'); await W(450);
main = await page.textContent('main');
ok('targets shown and synced to settings row', main.includes('2,000 kcal · 170 g protein') && (await server()).rows.find(r => r.key === 'settings').data.prefs.kcalTarget === 2000);
ok('target line drawn', !!(await page.$('#chart-food line[stroke="var(--goal)"]')));
ok('"within target" stat', /Within target\s*\d of 7 days/.test(main), main.match(/Within target.{0,14}/)?.[0]);
const box = await page.locator('#chart-food svg').boundingBox();
await page.mouse.click(box.x + box.width - 6, box.y + 100); await W(150);
ok('tooltip on today\'s bar', /so far/.test(await page.textContent('#chart-food .tip')) && /150 under/.test(await page.textContent('#chart-food .tip')), await page.textContent('#chart-food .tip'));
await tap('.tab[data-go="overview"]'); await W(250);
main = await page.textContent('main');
ok('Today card: 1,850 kcal, 150 left, protein of target', main.includes('Food today') && main.includes('150 kcal left of 2,000') && main.includes('Protein 160 g of 170'));
ok('Today card has the progress bar', !!(await page.$('main .card[data-go="food"] .prog')));
await page.screenshot({ path: shots + '/food-today-card.png' });

// 5. over target, protein hit
await shortcutPost({ key, kcal: 2310, protein: 175, date: shortcutDate() });
await page.evaluate(() => window.dispatchEvent(new Event('online'))); await W(500);
main = await page.textContent('main');
ok('over target: chip + warn bar', main.includes('Over target') && main.includes('310 kcal over') && !!(await page.$('main .card[data-go="food"] .prog.over')));

// 6. offline reload keeps food from the cache
await page.evaluate(() => { window.__mockOffline = true; }); await page.reload(); await page.waitForSelector('#loader', { state: 'detached' }); await W(300);
ok('offline reload still shows today\'s food', (await page.textContent('main')).includes('2,310'));
await page.evaluate(() => { window.__mockOffline = false; });

// 7. new key replaces the old one; disconnect
await tap('.tab[data-go="food"]'); await W(250); await tap('main [data-act="fuel8"]'); await W(400);
ok('sheet shows key ending + last used', (await page.textContent('.sheet')).includes('••' + key.slice(-4)) && (await page.textContent('.sheet')).includes('Last used today'));
await tap('.sheet [data-newkey]'); ok('new key asks to confirm', (await page.textContent('.sheet [data-newkey]')).includes('old key stops'));
await tap('.sheet [data-newkey]'); await W(900);
const key2 = (await page.textContent('.sheet [data-keyval]')).trim();
ok('new key works, old one doesn\'t', key2 !== key && (await shortcutPost({ key, kcal: 1 })).status === 401 && (await shortcutPost({ key: key2, kcal: 2310, protein: 175 })).status === 200);
await page.click('.sheet [data-close]'); await W(350); await tap('main [data-act="fuel8"]'); await W(400);
await tap('.sheet [data-disconnect]'); await tap('.sheet [data-disconnect]'); await W(500);
ok('disconnect removes the key, food stays', (await server()).keys.length === 0 && (await page.textContent('main')).includes('Not connected') && (await page.textContent('main')).includes('2,310'));

// 8. Aisling sees none of it
await tap('[data-act="settings"]'); await W(300);
ok('settings: Food section', (await page.textContent('.sheet')).includes('Daily targets') && (await page.textContent('.sheet')).includes('food days'));
await tap('.sheet [data-logout]'); await page.waitForSelector('#auth');
await tap('#auth [data-mode=signup]');
await page.fill('#auth input[name=name]', 'Aisling'); await page.fill('#auth input[name=email]', 'aisling@example.com'); await page.fill('#auth input[name=password]', 'secret456');
await tap('#auth button[type=submit]'); await page.waitForSelector('#auth', { state: 'detached' }); await W(600);
main = await page.textContent('main');
ok('Aisling: no Stephen food, gets the connect prompt', !main.includes('2,310') && main.includes('Track food from Fuel8'));

// 9. narrow phone: six tabs fit, nothing scrolls sideways
await page.setViewportSize({ width: 320, height: 640 }); await W(300);
await tap('.tab[data-go="food"]'); await W(250);
const fit = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth <= innerWidth, tabs: [...document.querySelectorAll('.tab')].every(t => t.scrollWidth <= t.clientWidth + 1) }));
ok('320px: no sideways overflow and tab labels fit', fit.doc && fit.tabs, fit);
await page.screenshot({ path: shots + '/food-320.png' });

ok('no page errors', errors.length === 0, errors);
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);

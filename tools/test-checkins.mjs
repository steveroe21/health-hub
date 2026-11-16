// Weekly check-ins in the installed app: Supabase accounts + private photo storage, all mocked in the page.
// Needs: python3 tools/build.py, test photos in /tmp/ciimg (p1..p6.jpg, bad.jpg).
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = new URL('../dist', import.meta.url).pathname;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); res.end(fs.readFileSync(f));
}).listen(8768);
const MOCK = `window.supabase = { createClient(url, key, opts) {
  const SK = opts.auth.storageKey;
  const srv = () => JSON.parse(localStorage.getItem('mock.server') || '{"users":[],"rows":[]}');
  const save = s => localStorage.setItem('mock.server', JSON.stringify(s));
  const files = () => JSON.parse(localStorage.getItem('mock.files') || '{}');
  const saveFiles = f => localStorage.setItem('mock.files', JSON.stringify(f));
  const L = []; const emit = (e, s) => L.forEach(f => f(e, s));
  const sess = () => JSON.parse(localStorage.getItem(SK) || 'null');
  const delay = () => new Promise(r => setTimeout(r, 40));
  const off = () => window.__mockOffline === true; const NE = { message: 'TypeError: Failed to fetch' };
  const login = u => { const { password, ...user } = u; const s = { user, access_token: 't' }; localStorage.setItem(SK, JSON.stringify(s)); emit('SIGNED_IN', s); return s; };
  const mine = p => { const c = sess(); return c && p.split('/')[0] === c.user.id; };   // storage RLS: first folder = your user id
  const toDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  return {
    auth: {
      async getSession() { return { data: { session: sess() }, error: null }; },
      onAuthStateChange(cb) { L.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signUp({ email, password, options }) { await delay(); const s = srv();
        const u = { id: 'uid-' + (s.users.length + 1), email, password, user_metadata: options.data }; s.users.push(u); save(s);
        const ss = login(u); return { data: { user: ss.user, session: ss }, error: null }; },
      async signInWithPassword({ email, password }) { await delay(); const u = srv().users.find(u => u.email === email && u.password === password);
        if (!u) return { data: {}, error: { message: 'Invalid login credentials' } }; const ss = login(u); return { data: { user: ss.user, session: ss }, error: null }; },
      async signOut() { localStorage.removeItem(SK); emit('SIGNED_OUT', null); return { error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async updateUser(a) { return { data: {}, error: null }; }
    },
    from() { return {
      async select() { await delay(); if (off()) return { data: null, error: NE }; const c = sess();
        return { data: c ? srv().rows.filter(r => r.user_id === c.user.id).map(r => ({ key: r.key, data: r.data })) : [], error: null }; },
      async upsert(row) { await delay(); if (off()) return { error: NE }; const c = sess();
        if (!c || row.user_id !== c.user.id) return { error: { message: 'new row violates row-level security policy' } };
        if (['settings','weights','lifts','runs','steps','checkins'].indexOf(row.key) < 0) return { error: { message: 'violates check constraint' } };
        const s = srv(); const i = s.rows.findIndex(r => r.user_id === row.user_id && r.key === row.key); if (i >= 0) s.rows[i] = row; else s.rows.push(row); save(s); return { error: null }; }
    }; },
    storage: { from(bucket) { return {
      async upload(p, blob, o) { await delay(); window.__uploads = (window.__uploads || 0) + 1;
        if (off()) return { data: null, error: NE };
        if (window.__failUploadAt && window.__uploads >= window.__failUploadAt) return { data: null, error: { message: 'Failed to fetch' } };
        if (bucket !== 'progress-photos' || !mine(p)) return { data: null, error: { message: 'new row violates row-level security policy' } };
        if (o.contentType !== 'image/jpeg' || blob.type !== 'image/jpeg') return { data: null, error: { message: 'mime type not allowed' } };
        const f = files(); f[p] = { url: await toDataUrl(blob), size: blob.size }; saveFiles(f); return { data: { path: p }, error: null }; },
      async createSignedUrls(paths, exp) { await delay(); window.__signed = (window.__signed || 0) + paths.length; if (off()) return { data: null, error: NE };
        const f = files(); return { data: paths.map(p => mine(p) && f[p] ? { path: p, signedUrl: f[p].url, error: null } : { path: p, signedUrl: null, error: 'Object not found' }), error: null }; },
      async remove(paths) { await delay(); const f = files(); const gone = []; paths.forEach(p => { if (mine(p) && f[p]) { delete f[p]; gone.push(p); } }); saveFiles(f); return { data: gone, error: null }; }
    }; } }
  };
} };`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.clock.setFixedTime(new Date('2026-11-15T10:30:00'));          // a Sunday
await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.HH_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk' };" }));
await ctx.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
await ctx.route('**/sw.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
const errors = []; const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const shots = new URL('../shots', import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
const W = ms => page.waitForTimeout(ms);
const ok = (label, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); if (!cond) process.exitCode = 1; };
const server = () => page.evaluate(() => JSON.parse(localStorage.getItem('mock.server')));
const rowFor = async (uid, key) => ((await server()).rows.find(r => r.user_id === uid && r.key === key) || {}).data;
const fileKeys = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mock.files') || '{}')).sort());
const loadedImgs = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(i => i.complete && i.naturalWidth > 0), sel);
const waitPhotos = (sel, n) => page.waitForFunction(([s, n]) => { const a = [...document.querySelectorAll(s)]; return a.length === n && a.every(i => i.complete && i.naturalWidth > 0); }, [sel, n], { timeout: 10000 }).then(() => true, () => false);
const P = n => '/tmp/ciimg/p' + n + '.jpg';

await page.goto('http://localhost:8768/HealthHub/');
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('#auth');
await page.click('#auth [data-mode=signup]');
await page.fill('#auth input[name=name]', 'Stephen'); await page.fill('#auth input[name=email]', 'stephen@example.com'); await page.fill('#auth input[name=password]', 'secret123');
await page.click('#auth button[type=submit]'); await page.waitForSelector('#auth', { state: 'detached' }); await W(400);
// an earlier hand-logged weigh-in, so deltas have something to compare to
await page.click('[data-act="add"][data-kind="weight"]'); await page.fill('.sheet input[name=date]', '2026-11-08'); await page.fill('.sheet input[name=kg]', '88.6'); await page.click('.sheet button[type=submit]'); await W(400);

// 1. Sunday section on Today
ok('Today shows Sunday check-in section', await page.isVisible('main [data-act="checkin"]'));
await page.screenshot({ path: shots + '/ci-today-sunday.png' });

// 2. empty check-in is refused
await page.click('main [data-act="checkin"]'); await W(350);
await page.screenshot({ path: shots + '/ci-form-empty.png' });
ok('Sunday preselected', (await page.inputValue('.sheet select[name=date]')) === '2026-11-15');
await page.click('.sheet button[type=submit]'); await W(100);
ok('empty check-in refused', (await page.textContent('.sheet .err')).includes('Add a weight'), await page.textContent('.sheet .err'));
ok('photo note says private', (await page.textContent('.sheet [data-phnote]')).includes('Only you'), await page.textContent('.sheet [data-phnote]'));

// 3. unreadable file, then 6 photos -> capped at 5
await page.setInputFiles('.sheet [data-file]', '/tmp/ciimg/bad.jpg'); await W(600);
ok('bad file rejected', (await page.textContent('.sheet .err')).includes('couldn’t be read'));
await page.setInputFiles('.sheet [data-file]', [P(1), P(2), P(3), P(4), P(5), P(6)]);
await page.waitForFunction(() => document.querySelectorAll('.sheet .ci-tile').length === 5 && !document.querySelector('.sheet .ci-tile.busy'), null, { timeout: 20000 });
ok('capped at 5 tiles, add button gone', (await page.$$('.sheet .ci-tile')).length === 5 && !(await page.$('.sheet .ci-add')));
ok('cap toast', (await page.textContent('#toast')).includes('first 5'), await page.textContent('#toast'));
await page.fill('.sheet input[name=kg]', '87.4');
await page.fill('.sheet textarea[name=summary]', 'Hit all 4 sessions and 70k steps.\nSleep was poor midweek.');
await page.screenshot({ path: shots + '/ci-form-filled.png' });
await page.click('.sheet button[type=submit]');
await page.waitForSelector('.sheet', { state: 'detached', timeout: 20000 }); await W(500);

// 4. stored correctly
let ci = await rowFor('uid-1', 'checkins');
const c0 = ci && ci.entries && ci.entries[0];
ok('check-in row saved', !!c0 && c0.date === '2026-11-15' && c0.kg === 87.4 && c0.photos.length === 5, c0 && { date: c0.date, kg: c0.kg, n: c0.photos.length });
ok('summary kept', c0.summary === 'Hit all 4 sessions and 70k steps.\nSleep was poor midweek.');
let keys = await fileKeys();
ok('10 files (full + thumb) under own folder', keys.length === 10 && keys.every(k => k.startsWith('uid-1/' + c0.id + '/')), keys.length);
const dims = c0.photos.map(p => [p.w, p.h]);
ok('photos shrunk to 1600px long edge, portrait', dims.every(([w, h]) => Math.max(w, h) === 1600 && h > w), dims);
ok('sideways photo turned upright (EXIF)', dims[2][1] > dims[2][0], dims[2]);
const sizes = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('mock.files'))).map(([k, v]) => [k.endsWith('_t.jpg') ? 't' : 'f', v.size]));
console.log('     sizes (KB): full', sizes.filter(s => s[0] === 'f').map(s => Math.round(s[1] / 1024)), 'thumb', sizes.filter(s => s[0] === 't').map(s => Math.round(s[1] / 1024)));
const wts = (await rowFor('uid-1', 'weights')).entries;
const sunW = wts.filter(w => w.date === '2026-11-15');
ok('weight added to weigh-ins once', sunW.length === 1 && sunW[0].kg === 87.4 && c0.weightId === sunW[0].id, sunW);

// 5. Today now shows done + thumbnails
ok('Today card shows done', (await page.textContent('main')).includes('This week’s check-in87.4 kg · 5 photos'), (await page.textContent('main .card.link')));
ok('Today thumbnails load', await waitPhotos('main .ci-thumbs img', 5));
await page.screenshot({ path: shots + '/ci-today-done.png' });

// 6. Weight tab list
await page.click('.tab[data-go="weight"]'); await W(300);
ok('weight tab lists check-in', (await page.$$('main .ci-item')).length === 1);
ok('delta vs earlier weigh-in not shown (first check-in)', !(await page.textContent('main .ci-item .r')).includes('−'));
await page.evaluate(() => document.querySelector('main .ci-item').scrollIntoView({ block: 'center' })); await W(200);
await page.screenshot({ path: shots + '/ci-weight-tab.png' });
const chartPts = await page.evaluate(() => document.querySelectorAll('#chart-weight circle').length);
ok('check-in weight is on the chart', chartPts >= 2, chartPts);

// 7. view + viewer
await page.click('main .ci-item'); await W(350);
ok('view sheet: 5 photos load', await waitPhotos('.sheet .ci-grid img', 5));
await page.screenshot({ path: shots + '/ci-view.png' });
await page.click('.sheet [data-pv="2"]'); await W(400);
ok('viewer full image loads', await waitPhotos('.pv .pv-full', 1));
ok('viewer counter', (await page.textContent('.pv .pv-c')) === '3 of 5');
await page.screenshot({ path: shots + '/ci-viewer.png' });
await page.click('.pv [data-pv-step="1"]'); await W(200);
ok('next photo', (await page.textContent('.pv .pv-c')) === '4 of 5');
await page.keyboard.press('Escape'); await W(300);
ok('viewer closed', !(await page.$('.pv')));

// 8. edit: remove one photo, change summary
await page.click('.sheet [data-edit]'); await W(450);
ok('edit form shows 5 saved photos', await waitPhotos('.sheet .ci-tile img', 5));
await page.click('.sheet [data-rm="0"]'); await W(100);
ok('add tile back after removing', !!(await page.$('.sheet .ci-add')));
await page.fill('.sheet textarea[name=summary]', 'Edited summary');
await page.click('.sheet button[type=submit]'); await page.waitForSelector('.sheet', { state: 'detached' }); await W(500);
ci = (await rowFor('uid-1', 'checkins')).entries[0];
keys = await fileKeys();
ok('edit saved: 4 photos, removed files deleted', ci.photos.length === 4 && keys.length === 8 && ci.summary === 'Edited summary', { n: ci.photos.length, files: keys.length });

// 9. reload: photos come back through signed links
await page.reload(); await page.waitForSelector('#loader', { state: 'detached' }); await W(600);
await page.click('.tab[data-go="weight"]');
ok('after reload thumbnails load via signed URLs', await waitPhotos('main .ci-thumbs img', 4));
ok('signed in one batch', (await page.evaluate(() => window.__signed)) === 4, await page.evaluate(() => window.__signed));

// 10. a second check-in for last Sunday from the Weight tab, offline photo upload refused, then upload failure cleans up
await page.click('main [data-act="checkin"]'); await W(350);
ok('next free Sunday offered', (await page.inputValue('.sheet select[name=date]')) === '2026-11-08');
ok('kg prefilled from that day\'s weigh-in', (await page.inputValue('.sheet input[name=kg]')) === '88.6');
await page.setInputFiles('.sheet [data-file]', [P(6), P(5)]);
await page.waitForFunction(() => document.querySelectorAll('.sheet .ci-tile').length === 2 && !document.querySelector('.sheet .ci-tile.busy'), null, { timeout: 15000 });
await page.evaluate(() => { window.__mockOffline = true; });
await page.context().setOffline(true);
await page.click('.sheet button[type=submit]'); await W(400);
ok('offline upload refused with message', (await page.textContent('.sheet .err')).includes('offline'), await page.textContent('.sheet .err'));
await page.context().setOffline(false); await page.evaluate(() => { window.__mockOffline = false; window.__uploads = 0; window.__failUploadAt = 3; });
await page.click('.sheet button[type=submit]'); await W(800);
ok('upload failure message', (await page.textContent('.sheet .err')).includes('Couldn’t upload'), await page.textContent('.sheet .err'));
ok('partial upload cleaned up', (await fileKeys()).length === 8, (await fileKeys()).length);
await page.evaluate(() => { window.__failUploadAt = 0; });
await page.click('.sheet button[type=submit]'); await page.waitForSelector('.sheet', { state: 'detached', timeout: 15000 }); await W(500);
const all = (await rowFor('uid-1', 'checkins')).entries;
ok('second check-in saved, sorted by date', all.length === 2 && all[0].date === '2026-11-08' && all[1].date === '2026-11-15');
ok('reused the hand-logged weigh-in, no duplicate', (await rowFor('uid-1', 'weights')).entries.filter(w => w.date === '2026-11-08').length === 1);
ok('12 files now', (await fileKeys()).length === 12);
ok('list shows delta on newer check-in', (await page.textContent('main .ci-item >> nth=0')).includes('−1.2'), await page.textContent('main .ci-item >> nth=0 >> .r'));

// 11. another person can't see Stephen's check-ins or photos
await page.click('[data-act="settings"]'); await W(300);
ok('settings counts check-ins', (await page.textContent('.sheet')).includes('2 check-ins'));
await page.click('.sheet [data-logout]'); await page.waitForSelector('#auth');
await page.click('#auth [data-mode=signup]');
await page.fill('#auth input[name=name]', 'Aisling'); await page.fill('#auth input[name=email]', 'aisling@example.com'); await page.fill('#auth input[name=password]', 'another123');
await page.click('#auth button[type=submit]'); await page.waitForSelector('#auth', { state: 'detached' }); await W(500);
ok('Aisling sees no check-ins, gets the Sunday prompt', (await page.evaluate(() => window.__hh.state.checkins.length)) === 0 && await page.isVisible('main [data-act="checkin"]'));
const stolen = await page.evaluate(async () => { const s = window.supabase.createClient('', '', { auth: { storageKey: 'healthhub.auth' } }); const f = JSON.parse(localStorage.getItem('mock.files')); const k = Object.keys(f)[0]; return (await s.storage.from('progress-photos').createSignedUrls([k], 60)).data[0].signedUrl; });
ok('Aisling cannot get a link to Stephen\'s photo', stolen === null);
await page.click('[data-act="settings"]'); await page.click('.sheet [data-logout]'); await page.waitForSelector('#auth');
await page.fill('#auth input[name=email]', 'stephen@example.com'); await page.fill('#auth input[name=password]', 'secret123'); await page.click('#auth button[type=submit]');
await page.waitForSelector('#auth', { state: 'detached' }); await W(600);

// 12. delete a check-in: photos go, weigh-in stays
await page.click('.tab[data-go="weight"]'); await W(200);
await page.click('main .ci-item >> nth=0'); await W(350); await page.click('.sheet [data-edit]'); await W(450);
await page.click('.sheet [data-del]'); await page.click('.sheet [data-del]'); await W(700);
ok('deleted: 1 check-in left, only its 4 files remain', (await rowFor('uid-1', 'checkins')).entries.length === 1 && (await fileKeys()).length === 4, (await fileKeys()).length);
ok('weigh-in from deleted check-in kept', (await rowFor('uid-1', 'weights')).entries.some(w => w.date === '2026-11-15'));

// 13. clearing the weight on a check-in removes the weigh-in it created
await page.click('main .ci-item >> nth=0'); await W(350); await page.click('.sheet [data-edit]'); await W(450);
await page.fill('.sheet input[name=kg]', '');
await page.click('.sheet button[type=submit]'); await page.waitForSelector('.sheet', { state: 'detached' }); await W(500);
ok('linked hand-logged weigh-in kept when weight cleared', (await rowFor('uid-1', 'weights')).entries.some(w => w.date === '2026-11-08'));

// 14. Monday: no Sunday section on Today
await page.clock.setFixedTime(new Date('2026-11-16T09:00:00'));
await page.click('.tab[data-go="overview"]'); await W(200);
ok('no check-in section on Monday', !(await page.$('main [data-act="checkin"]')) && !(await page.textContent('main')).includes('Sunday check-in'));

console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); srv.close();

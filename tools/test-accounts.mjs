import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = new URL('../dist', import.meta.url).pathname;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); res.end(fs.readFileSync(f));
}).listen(8767);
const MOCK = `window.supabase = { createClient(url, key, opts) {
  const SK = opts.auth.storageKey;
  const srv = () => JSON.parse(localStorage.getItem('mock.server') || '{"users":[],"rows":[]}');
  const save = s => localStorage.setItem('mock.server', JSON.stringify(s));
  const L = []; const emit = (e, s) => L.forEach(f => f(e, s));
  const sess = () => JSON.parse(localStorage.getItem(SK) || 'null');
  const delay = () => new Promise(r => setTimeout(r, 60));
  const off = () => window.__mockOffline === true; const NE = { message: 'TypeError: Failed to fetch' };
  const login = u => { const { password, ...user } = u; const s = { user, access_token: 't' }; localStorage.setItem(SK, JSON.stringify(s)); emit('SIGNED_IN', s); return s; };
  return {
    auth: {
      async getSession() { return { data: { session: sess() }, error: null }; },
      onAuthStateChange(cb) { L.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signUp({ email, password, options }) { await delay(); if (off()) return { data: {}, error: NE }; const s = srv();
        if (s.users.find(u => u.email === email)) return { data: {}, error: { message: 'User already registered' } };
        const u = { id: 'uid-' + (s.users.length + 1), email, password, user_metadata: options.data }; s.users.push(u); save(s);
        if (window.__mockConfirm) return { data: { user: u, session: null }, error: null };
        const ss = login(u); return { data: { user: ss.user, session: ss }, error: null }; },
      async signInWithPassword({ email, password }) { await delay(); const u = srv().users.find(u => u.email === email && u.password === password);
        if (!u) return { data: {}, error: { message: 'Invalid login credentials' } }; const ss = login(u); return { data: { user: ss.user, session: ss }, error: null }; },
      async signOut() { localStorage.removeItem(SK); emit('SIGNED_OUT', null); return { error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async updateUser(a) { const s = srv(), cur = sess(); const u = s.users.find(x => x.id === cur.user.id); if (a.data) u.user_metadata = { ...u.user_metadata, ...a.data }; save(s);
        cur.user.user_metadata = u.user_metadata; localStorage.setItem(SK, JSON.stringify(cur)); emit('USER_UPDATED', cur); return { data: { user: cur.user }, error: null }; }
    },
    from() { return {
      async select() { await delay(); if (off()) return { data: null, error: NE }; const c = sess(); window.__selects = (window.__selects || 0) + 1;
        return { data: c ? srv().rows.filter(r => r.user_id === c.user.id).map(r => ({ key: r.key, data: r.data })) : [], error: null }; },
      async upsert(row) { await delay(); if (off()) return { error: NE }; const c = sess();
        if (!c || row.user_id !== c.user.id) return { error: { message: 'new row violates row-level security policy' } };
        const s = srv(); const i = s.rows.findIndex(r => r.user_id === row.user_id && r.key === row.key); if (i >= 0) s.rows[i] = row; else s.rows.push(row); save(s); return { error: null }; }
    }; }
  };
} };`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.HH_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk' };" }));
await ctx.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
await ctx.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }));
const errors = []; const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const shots = new URL('../shots', import.meta.url).pathname;
const W = ms => page.waitForTimeout(ms);
const server = () => page.evaluate(() => JSON.parse(localStorage.getItem('mock.server')));
const rowsFor = async (uid, key) => ((await server()).rows.find(r => r.user_id === uid && r.key === key) || {}).data;

// legacy (pre-login) data on this phone
await page.goto('http://localhost:8767/HealthHub/');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('healthhub.v1', JSON.stringify({ weights: [{ id: 'old1', date: '2026-11-10', kg: 90.1 }, { id: 'old2', date: '2026-11-12', kg: 89.6 }] })); });
await page.reload(); await page.waitForSelector('#auth');
await page.screenshot({ path: shots + '/login.png' });
console.log('login screen shown:', await page.isVisible('#auth form'));

// 1. Stephen signs up
await page.click('#auth [data-mode=signup]'); await page.screenshot({ path: shots + '/signup.png' });
await page.fill('#auth input[name=name]', 'Stephen'); await page.fill('#auth input[name=email]', 'stephen@example.com'); await page.fill('#auth input[name=password]', 'short');
await page.click('#auth button[type=submit]'); console.log('short pw error:', await page.textContent('#auth .err'));
await page.fill('#auth input[name=password]', 'secret123'); await page.click('#auth button[type=submit]');
await page.waitForSelector('#auth', { state: 'detached' }); await W(400);
console.log('title:', await page.textContent('#title'));
console.log('legacy prompt:', await page.isVisible('.sheet [data-yes]'));
await page.screenshot({ path: shots + '/legacy-prompt.png' });
await page.click('.sheet [data-yes]'); await W(500);
await page.click('[data-act="add"][data-kind="weight"]'); await page.fill('.sheet input[name=kg]', '88.0'); await page.click('.sheet button[type=submit]'); await W(500);
await page.screenshot({ path: shots + '/welcome-stephen.png' });
console.log('stephen server weights:', (await rowsFor('uid-1', 'weights')).entries.map(e => e.kg));
console.log('sync:', await page.textContent('#syncText'));

// 2. log out, Aisling signs up
await page.click('[data-act="settings"]'); await W(300); await page.screenshot({ path: shots + '/settings-account.png' });
await page.click('.sheet [data-logout]'); await page.waitForSelector('#auth');
console.log('after logout main empty:', (await page.textContent('#main')).trim() === '');
await page.click('#auth [data-mode=signup]');
await page.fill('#auth input[name=name]', 'Aisling'); await page.fill('#auth input[name=email]', 'aisling@example.com'); await page.fill('#auth input[name=password]', 'another123');
await page.click('#auth button[type=submit]'); await page.waitForSelector('#auth', { state: 'detached' }); await W(400);
console.log('title:', await page.textContent('#title'), '| legacy prompt for Aisling:', await page.isVisible('.sheet [data-yes]'), '| weights:', await page.evaluate(() => window.__hh.state.weights.length));
await page.click('[data-act="add"][data-kind="weight"]'); await page.fill('.sheet input[name=kg]', '62.5'); await page.click('.sheet button[type=submit]'); await W(500);
await page.click('.tab[data-go="weight"]'); await W(100);
console.log('aisling sees:', await page.evaluate(() => window.__hh.state.weights.map(e => e.kg)));

// 3. offline logging then reconnect
await page.evaluate(() => { window.__mockOffline = true; });
await page.click('[data-act="add"][data-kind="weight"]'); await page.fill('.sheet input[name=kg]', '62.1'); await page.fill('.sheet input[name=date]', '2026-11-15'); await page.click('.sheet button[type=submit]'); await W(400);
console.log('offline: sync text =', await page.textContent('#syncText'), '| server has', (await rowsFor('uid-2', 'weights')).entries.length);
await page.evaluate(() => { window.__mockOffline = false; window.dispatchEvent(new Event('online')); }); await W(500);
console.log('back online: sync text =', await page.textContent('#syncText'), '| server has', (await rowsFor('uid-2', 'weights')).entries.map(e => e.kg));

// 4. wrong password, then Stephen logs back in and sees only his data
await page.click('[data-act="settings"]'); await W(300); await page.click('.sheet [data-logout]'); await page.waitForSelector('#auth');
await page.fill('#auth input[name=email]', 'stephen@example.com'); await page.fill('#auth input[name=password]', 'wrongpass'); await page.click('#auth button[type=submit]'); await W(300);
console.log('wrong pw:', await page.textContent('#auth .err'));
await page.fill('#auth input[name=password]', 'secret123'); await page.click('#auth button[type=submit]'); await page.waitForSelector('#auth', { state: 'detached' }); await W(500);
console.log('stephen sees:', await page.evaluate(() => window.__hh.state.weights.map(e => e.kg)), '| title:', await page.textContent('#title'));
// 5. reload keeps him logged in; rename
await page.reload(); await page.waitForSelector('#loader', { state: 'detached' }); await W(400);
console.log('after reload logged in:', !(await page.$('#auth')), '| title:', await page.textContent('#title'));
await page.click('[data-act="settings"]'); await W(300); await page.fill('.sheet input[name=nm]', 'Steve'); await page.click('.sheet [data-name-form] button'); await W(300);
await page.click('.sheet [data-close]'); await W(300); console.log('renamed title:', await page.textContent('#title'));
// 6. RLS: client cannot write another person's row
// 7. email-confirmation flow
await page.click('[data-act="settings"]'); await W(300); await page.click('.sheet [data-logout]'); await page.waitForSelector('#auth');
await page.evaluate(() => { window.__mockConfirm = true; });
await page.click('#auth [data-mode=signup]'); await page.fill('#auth input[name=name]', 'Test'); await page.fill('#auth input[name=email]', 'test@example.com'); await page.fill('#auth input[name=password]', 'testtest1');
await page.click('#auth button[type=submit]'); await W(300); console.log('confirm note:', (await page.textContent('#auth .note')).trim());
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); srv.close();

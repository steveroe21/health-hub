// Runs the REAL supabase-js (vendor/supabase.js) with the project's real config,
// answering its HTTP calls with a fake GoTrue + PostgREST that enforces per-user access.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const root = new URL('../dist', import.meta.url).pathname;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); res.end(fs.readFileSync(f));
}).listen(8768);
const users = [], rows = [], tokens = {}, log = [];
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = u => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, user_metadata: u.user_metadata }) + '.sig';
const session = u => { const t = jwt(u); tokens[t] = u; return { access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: crypto.randomUUID(), user: pub(u) }; };
const pub = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), user_metadata: u.user_metadata, app_metadata: { provider: 'email' }, created_at: new Date().toISOString() });
const who = h => tokens[(h['authorization'] || '').replace(/^Bearer /, '')];

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }));
await ctx.route('https://tldbofbnqdloddgivktk.supabase.co/**', async (route) => {
  const req = route.request(), url = new URL(req.url()), h = req.headers(), m = req.method();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (status, obj) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
  log.push(`${m} ${url.pathname}${url.search} apikey=${(h.apikey || '').slice(0, 15)}… prefer=${h.prefer || ''}`);
  if (m === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (url.pathname === '/auth/v1/signup') {
    if (users.find(u => u.email === body.email)) return json(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    const u = { id: crypto.randomUUID(), email: body.email, password: body.password, user_metadata: body.data || {} }; users.push(u); return json(200, session(u));
  }
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const u = users.find(x => x.email === body.email && x.password === body.password);
    return u ? json(200, session(u)) : json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (url.pathname === '/auth/v1/user' && m === 'PUT') { const u = who(h); if (!u) return json(401, { msg: 'no' }); if (body.data) u.user_metadata = { ...u.user_metadata, ...body.data }; return json(200, pub(u)); }
  if (url.pathname === '/auth/v1/user') { const u = who(h); return u ? json(200, pub(u)) : json(401, { msg: 'no' }); }
  if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (url.pathname === '/rest/v1/health_data') {
    const u = who(h); if (!u) return json(401, { message: 'permission denied for table health_data' });
    if (m === 'GET') return json(200, rows.filter(r => r.user_id === u.id).map(r => ({ key: r.key, data: r.data })));
    if (m === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      for (const r of list) {
        if (r.user_id !== u.id) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "health_data"' });
        const i = rows.findIndex(x => x.user_id === r.user_id && x.key === r.key);
        if (i >= 0) { if (!/merge-duplicates/.test(h.prefer || '')) return json(409, { message: 'duplicate key' }); rows[i] = r; } else rows.push(r);
      }
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
  }
  return json(404, { message: 'unhandled ' + url.pathname });
});
const errors = []; const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
await page.goto('http://localhost:8768/HealthHub/'); await page.waitForSelector('#auth form');
console.log('config loaded:', await page.evaluate(() => window.HH_CONFIG.supabaseUrl), '| supabase-js:', await page.evaluate(() => typeof window.supabase.createClient));
async function signup(name, email, pw) {
  await page.click('#auth [data-mode=signup]'); await page.fill('#auth input[name=name]', name); await page.fill('#auth input[name=email]', email); await page.fill('#auth input[name=password]', pw);
  await page.click('#auth button[type=submit]'); await page.waitForSelector('#auth', { state: 'detached', timeout: 8000 }); await W(800);
}
async function logWeight(kg) { await page.click('[data-act="add"][data-kind="weight"]'); await page.fill('.sheet input[name=kg]', kg); await page.click('.sheet button[type=submit]'); await W(800); }
async function logout() { await page.click('[data-act="settings"]'); await W(300); await page.click('.sheet [data-logout]'); await page.waitForSelector('#auth form'); }
await signup('Stephen', 'stephen@test.dev', 'password123'); console.log('title:', await page.textContent('#title'), '| sync:', await page.textContent('#syncText'));
await logWeight('88.4');
await logout();
await signup('Aisling', 'aisling@test.dev', 'password456'); console.log('title:', await page.textContent('#title'), '| weights visible:', await page.evaluate(() => window.__hh.state.weights.length));
await logWeight('61.9');
await logout();
await page.fill('#auth input[name=email]', 'stephen@test.dev'); await page.fill('#auth input[name=password]', 'nope'); await page.click('#auth button[type=submit]'); await W(800);
console.log('wrong pw msg:', await page.textContent('#auth .err'));
await page.fill('#auth input[name=password]', 'password123'); await page.click('#auth button[type=submit]'); await page.waitForSelector('#auth', { state: 'detached' }); await W(900);
console.log('stephen back:', await page.textContent('#title'), await page.evaluate(() => window.__hh.state.weights.map(w => w.kg)));
await page.reload(); await page.waitForSelector('#loader', { state: 'detached' }); await W(900);
console.log('after reload:', await page.textContent('#title'), '| still logged in:', !(await page.$('#auth')));
console.log('server rows:', rows.map(r => `${users.find(u => u.id === r.user_id).user_metadata.name}/${r.key}=${JSON.stringify(r.data.entries ? r.data.entries.map(e => e.kg) : Object.keys(r.data))}`).join('  '));
console.log('requests:\n  ' + [...new Set(log.map(l => l.replace(/[0-9a-f-]{36}/g, '…')))].slice(0, 12).join('\n  '));
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); srv.close();

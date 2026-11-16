// Weekly check-ins in the Claude-hosted version: db + user + assets capabilities mocked; /_blob/<id> served by this test server.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs';
const html = fs.readFileSync(new URL('../dist/artifact/index.html', import.meta.url).pathname, 'utf8');
const blobs = new Map(); let deletes = 0;
const srv = http.createServer((q, r) => {
  const m = q.url.match(/^\/(_blob|__up|__del)\/([a-f0-9]{32})$/);
  if (m && m[1] === '__up'){ const parts = []; q.on('data', c => parts.push(c)); q.on('end', () => { blobs.set(m[2], { type: q.headers['content-type'], body: Buffer.concat(parts) }); r.end('ok'); }); return; }
  if (m && m[1] === '__del'){ deletes++; blobs.delete(m[2]); return r.end('ok'); }
  if (m && m[1] === '_blob'){ const b = blobs.get(m[2]); if (!b){ r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': b.type }); return r.end(b.body); }
  r.writeHead(200, { 'content-type': 'text/html' }); r.end(html);
}).listen(8769);
const mock = () => {
  const KEY = 'mockdb';
  const load = () => JSON.parse(sessionStorage.getItem(KEY) || '{}');
  const saveDb = d => sessionStorage.setItem(KEY, JSON.stringify(d));
  const listeners = [];
  const snap = (prefix) => {
    const d = load(); const docs = Object.keys(d).filter(p => p.startsWith(prefix + '/')).map(p => ({ id: p.slice(prefix.length + 1), exists: true, data: () => Object.freeze(JSON.parse(JSON.stringify(d[p]))), metadata: {} }));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] };
  };
  const fire = () => listeners.forEach(l => l.next(snap(l.prefix)));
  const db = { collection(prefix) { return {
    onSnapshot(next) { listeners.push({ prefix, next }); setTimeout(() => next(snap(prefix)), 200); return () => {}; },
    doc(id) { return { set: async (data) => { await new Promise(r => setTimeout(r, 30)); const d = load(); d[prefix + '/' + id] = data; saveDb(d); setTimeout(fire, 10); } }; }
  }; } };
  const user = { id: async () => 'u123', me: async () => ({ name: 'Stephen Roe' }) };
  const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  const assets = Object.freeze({
    async upload(blob, o) { if (!(blob instanceof Blob) || !blob.size) throw { code: 'invalid_request' }; if ((o && o.type) !== 'image/jpeg') throw { code: 'unsupported_type' };
      const id = hex(); await fetch('/__up/' + id, { method: 'POST', body: blob, headers: { 'content-type': o.type } }); window.__assetUploads = (window.__assetUploads || 0) + 1;
      return { id, url: '/_blob/' + id, sizeBytes: blob.size, contentType: o.type }; },
    async list() { return { assets: [], usage: {} }; },
    async delete(id) { await fetch('/__del/' + id); return { deleted: true }; }
  });
  window.claude = { use: (n) => new Promise(r => setTimeout(() => r(n === 'db' ? db : n === 'user' ? user : n === 'assets' && !window.__noAssets ? assets : null), 150)) };
};
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.clock.setFixedTime(new Date('2026-11-15T19:00:00'));
await ctx.addInitScript(mock);
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
const ok = (label, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); if (!cond) process.exitCode = 1; };
const doc = id => page.evaluate(id => JSON.parse(sessionStorage.getItem('mockdb'))['data/users/u123/' + id], id);
const waitPhotos = (sel, n) => page.waitForFunction(([s, n]) => { const a = [...document.querySelectorAll(s)]; return a.length === n && a.every(i => i.complete && i.naturalWidth > 0); }, [sel, n], { timeout: 10000 }).then(() => true, () => false);

await page.goto('http://localhost:8769/'); await page.waitForSelector('#loader', { state: 'detached' });
ok('cloud mode', (await page.evaluate(() => window.__hh.Store.mode)) === 'cloud');
await page.click('main [data-act="checkin"]'); await W(400);
ok('photo note for Claude version', (await page.textContent('.sheet [data-phnote]')).includes('Saved privately with this page'), await page.textContent('.sheet [data-phnote]'));
await page.fill('.sheet input[name=kg]', '86.9'); await page.fill('.sheet textarea[name=summary]', 'Good week');
await page.setInputFiles('.sheet [data-file]', ['/tmp/ciimg/p1.jpg', '/tmp/ciimg/p3.jpg']);
await page.waitForFunction(() => document.querySelectorAll('.sheet .ci-tile').length === 2 && !document.querySelector('.sheet .ci-tile.busy'), null, { timeout: 15000 });
await page.click('.sheet button[type=submit]'); await page.waitForSelector('.sheet', { state: 'detached', timeout: 15000 }); await W(500);
const d = await doc('checkins-2026');
ok('saved to checkins-2026 doc with asset pointers', d && d.entries.length === 1 && d.entries[0].photos.length === 2 && d.entries[0].photos.every(p => p.via === 'asset' && /^[a-f0-9]{32}$/.test(p.full)), d && d.entries[0].photos.map(p => p.via));
ok('4 assets uploaded (full + thumb)', blobs.size === 4, blobs.size);
ok('weigh-in written too', ((await doc('weights-2026')) || { entries: [] }).entries.some(w => w.date === '2026-11-15' && w.kg === 86.9));
await page.reload(); await page.waitForSelector('#loader', { state: 'detached' }); await W(600);
ok('after reload: Today thumbnails load from /_blob/', await waitPhotos('main .ci-thumbs img', 2));
ok('thumb src is /_blob/<id>', (await page.getAttribute('main .ci-thumbs img', 'src')).startsWith('/_blob/'));
await page.click('main [data-act="viewci"]'); await W(400); await page.click('.sheet [data-pv="1"]'); await W(300);
ok('viewer full photo loads', await waitPhotos('.pv .pv-full', 1));
await page.keyboard.press('Escape'); await W(250);
await page.click('.sheet [data-edit]'); await W(450); await page.click('.sheet [data-rm="0"]'); await page.click('.sheet button[type=submit]'); await W(800);
ok('removed photo deleted from assets', blobs.size === 2 && deletes === 2, { left: blobs.size, deletes });
// no assets capability (e.g. someone without edit rights): weight + summary still work, photos switched off
await page.evaluate(() => { window.__noAssets = true; });
const p2 = await ctx.newPage(); p2.on('pageerror', e => errors.push('p2 ' + e.message));
await p2.addInitScript(() => { window.__noAssets = true; });
await p2.goto('http://localhost:8769/'); await p2.waitForSelector('#loader', { state: 'detached' });
await p2.click('.tab[data-go="weight"]'); await p2.click('main [data-act="checkin"]'); await p2.waitForTimeout(600);
ok('no assets: add photo disabled with a note', !!(await p2.$('.sheet .ci-add.off')) && (await p2.textContent('.sheet [data-phnote]')).includes('can’t be saved'), await p2.textContent('.sheet [data-phnote]'));
await p2.fill('.sheet textarea[name=summary]', 'No photos this time'); await p2.click('.sheet button[type=submit]'); await p2.waitForTimeout(600);
ok('no assets: text-only check-in saves', !(await p2.$('.sheet')) && (await p2.evaluate(() => window.__hh.state.checkins.length)) === 1);
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); srv.close();

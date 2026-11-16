import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs';
const html = fs.readFileSync(new URL('../dist/artifact/index.html', import.meta.url).pathname, 'utf8');
const srv = http.createServer((q, r) => { r.writeHead(200, {'content-type':'text/html'}); r.end(html); }).listen(8766);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [];
// Mock of the artifact db + user capabilities, persisted in sessionStorage so reloads see saved docs
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
  window.__mockFire = fire;
  window.__mockWrites = 0;
  const db = {
    collection(prefix) {
      return {
        onSnapshot(next, err) { const l = { prefix, next }; listeners.push(l); setTimeout(() => next(snap(prefix)), 300); return () => {}; },
        doc(id) { return { set: async (data) => { window.__mockWrites++; await new Promise(r => setTimeout(r, 50)); const d = load(); d[prefix + '/' + id] = data; saveDb(d); setTimeout(fire, 10); } }; }
      };
    }
  };
  const user = { id: async () => 'u123', isOwner: () => true };
  window.claude = { use: (n) => new Promise(r => setTimeout(() => r(n === 'db' ? db : n === 'user' ? user : null), 200)) };
};
await ctx.addInitScript(mock);
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8766/');
await page.waitForSelector('#loader', { state: 'detached' });
console.log('mode:', await page.evaluate(() => window.__hh.Store.mode), '| sync:', await page.textContent('#syncText'));
// add a weigh-in and a manual lift on 12 Nov, then goal
await page.click('[data-act="add"][data-kind="weight"]');
await page.fill('.sheet input[name=kg]', '88.2'); await page.click('.sheet button[type=submit]'); await page.waitForTimeout(500);
await page.click('[data-act="add"][data-kind="lift"]');
await page.fill('.sheet input[name=date]', '2026-11-12'); await page.fill('.sheet input[name=volume]', '9000'); await page.click('.sheet button[type=submit]'); await page.waitForTimeout(500);
const docs = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mockdb')));
console.log('docs:', Object.keys(docs), JSON.stringify(docs['data/users/u123/weights-2026']));
console.log('sync after save:', await page.textContent('#syncText'), '| writes:', await page.evaluate(() => window.__mockWrites));
// Hevy import should skip the 12 Nov day because a manual session exists
await page.click('.tab[data-go="lifting"]'); await page.click('[data-act="hevy"]');
await page.setInputFiles('.sheet input[name=file]', '/tmp/hevy.csv'); await page.waitForSelector('[data-go-import]');
console.log('hevy w/ manual day:', (await page.textContent('.sheet .calc')).trim());
await page.click('.sheet [data-close]'); await page.waitForTimeout(300);
// external change (another device) arrives
await page.evaluate(() => { const d = JSON.parse(sessionStorage.getItem('mockdb')); d['data/users/u123/steps-2026'] = { entries: [{ id: 'x1', date: '2026-11-16', steps: 4321 }] }; sessionStorage.setItem('mockdb', JSON.stringify(d)); window.__mockFire(); });
await page.waitForTimeout(200);
await page.click('.tab[data-go="steps"]');
console.log('remote steps visible:', (await page.textContent('main')).includes('4,321'));
// reload: data comes back from store
await page.reload(); await page.waitForSelector('#loader', { state: 'detached' });
console.log('after reload:', await page.evaluate(() => ({ w: window.__hh.state.weights.length, l: window.__hh.state.lifts.length, s: window.__hh.state.steps.length })));
// delete weigh-in -> shard rewritten empty
await page.click('.tab[data-go="weight"]'); await page.click('.list .item >> nth=0'); await page.click('.sheet [data-del]'); await page.click('.sheet [data-del]'); await page.waitForTimeout(500);
console.log('weights shard after delete:', await page.evaluate(() => JSON.stringify(JSON.parse(sessionStorage.getItem('mockdb'))['data/users/u123/weights-2026'])));
// no-capability fallback
const p3 = await browser.newPage(); p3.on('pageerror', e => errors.push('p3 ' + e.message));
await p3.goto('http://localhost:8766/'); await p3.waitForSelector('#loader', { state: 'detached', timeout: 15000 });
console.log('fallback mode:', await p3.evaluate(() => window.__hh.Store.mode), '| banner:', !!(await p3.$('.banner')));
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); srv.close();

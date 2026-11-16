import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = new URL('../dist', import.meta.url).pathname;
const srv = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.woff2') ? 'font/woff2' : 'text/javascript' }); res.end(fs.readFileSync(f)); }).listen(8770);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.HH_CONFIG = {};' }));
await ctx.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { if (!sessionStorage.getItem('s')) { const d = k => { const x = new Date(); x.setDate(x.getDate() - k); return x.toISOString().slice(0, 10); };
  localStorage.setItem('healthhub.v1', JSON.stringify({ weights: [{ id: 'a', date: d(3), kg: 96 }, { id: 'b', date: d(0), kg: 95.5 }], runs: [{ id: 'r', date: d(1), km: 3 }], steps: [{ id: 's', date: d(1), steps: 12821 }],
    goals: { weight: { startDate: d(0), startKg: 95.5, targetKg: 82, targetDate: d(-150) }, volume: { startDate: d(0), startValue: 30000, target: 30000, targetDate: d(-30) }, distance: { startDate: d(0), startValue: 10, target: 10, targetDate: d(-30) }, steps: { startDate: d(0), startValue: 70000, target: 70000, targetDate: d(-30) } } }));
  sessionStorage.setItem('s', '1'); } });
await page.goto('http://localhost:8770/HealthHub/'); await page.waitForSelector('#loader', { state: 'detached' });
const vh = 852;
const pos = async () => page.evaluate(() => { const t = document.querySelector('.tabbar').getBoundingClientRect(), h = document.querySelector('.topbar').getBoundingClientRect(), sc = document.querySelector('#scroll');
  return { tabTop: Math.round(t.top), tabBottom: Math.round(t.bottom), headTop: Math.round(h.top), scrollTop: Math.round(sc.scrollTop), scrollMax: sc.scrollHeight - sc.clientHeight, pageScroll: document.scrollingElement.scrollTop, pageScrollable: document.scrollingElement.scrollHeight > innerHeight }; });
console.log('top:    ', JSON.stringify(await pos()));
// scroll by touch-like wheel over the content, then all the way down
await page.mouse.move(200, 500); for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400); await page.waitForTimeout(200);
console.log('wheel:  ', JSON.stringify(await pos()));
await page.evaluate(() => { const sc = document.querySelector('#scroll'); sc.scrollTop = sc.scrollHeight; window.scrollTo(0, 500); }); await page.waitForTimeout(150);
const p = await pos(); console.log('bottom: ', JSON.stringify(p));
console.log('tab bar pinned to bottom:', p.tabBottom === vh, '| header pinned to top:', p.headTop === 0, '| page itself never scrolls:', p.pageScroll === 0 && !p.pageScrollable);
await page.screenshot({ path: new URL('../shots/scrolled-bottom.png', import.meta.url).pathname });
// every tab: content reachable above the bar, and switching tabs resets to top
for (const v of ['weight', 'lifting', 'running', 'steps', 'overview']) { await page.click(`.tab[data-go="${v}"]`); await page.waitForTimeout(80); const q = await pos(); if (q.scrollTop !== 0 || q.tabBottom !== vh) console.log('PROBLEM on', v, JSON.stringify(q)); }
// sheet + keyboard-ish focus/blur, then bars still in place
await page.click('[data-act="add"][data-kind="steps"]'); await page.waitForSelector('.sheet.open'); await page.fill('.sheet input[name=steps]', '9000'); await page.click('.sheet button[type=submit]'); await page.waitForTimeout(500);
console.log('after logging steps:', JSON.stringify(await pos()));
// last card fully visible above the tab bar when scrolled down
await page.evaluate(() => { const sc = document.querySelector('#scroll'); sc.scrollTop = sc.scrollHeight; }); await page.waitForTimeout(100);
console.log('last card ends above tab bar:', await page.evaluate(() => { const cards = [...document.querySelectorAll('#main .card')]; return Math.round(cards.at(-1).getBoundingClientRect().bottom) <= Math.round(document.querySelector('.tabbar').getBoundingClientRect().top); }));
// workout running: resume bar sits above tab bar and content clears it
await page.click('.tab[data-go="lifting"]'); await page.click('[data-act="startwk"]'); await page.waitForSelector('#wk'); await page.click('#wk [data-wk="min"]'); await page.waitForTimeout(200);
console.log('resume bar above tabs:', await page.evaluate(() => document.querySelector('#resume').getBoundingClientRect().bottom <= document.querySelector('.tabbar').getBoundingClientRect().top));
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close(); srv.close();

// Renders the "hh." app icon from the brand board in the brand font, at 1024px.
import { chromium } from 'playwright-core';
import fs from 'fs';
const font = fs.readFileSync(new URL('../fonts/archivo-wdth.woff2', import.meta.url)).toString('base64');
const html = (size) => `<!DOCTYPE html><html><head><style>
@font-face{font-family:A;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;font-stretch:62% 125%}
html,body{margin:0;width:1024px;height:1024px;background:#0F2D52}
.t{width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;font-family:A;font-weight:800;font-stretch:125%;
   font-size:${size}px;letter-spacing:-.05em;color:#ECE7E1;line-height:1;padding-bottom:${Math.round(size * 0.08)}px;box-sizing:border-box}
.d{display:inline-block;width:.2em;height:.2em;border-radius:50%;background:#E0354B;margin-left:.04em;vertical-align:baseline}
</style></head><body><div class="t">hh<span class="d"></span></div></body></html>`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [name, size] of [['icon-src', 470], ['icon-maskable-src', 360]]) {
  await page.setContent(html(size)); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200);
  await page.screenshot({ path: new URL(`../img/${name}.png`, import.meta.url).pathname });
}
await browser.close();
console.log('icons rendered');

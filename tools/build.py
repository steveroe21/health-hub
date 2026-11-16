import os, re, shutil, zipfile, json
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(f'{ROOT}/src/app.html').read()
dist = f'{ROOT}/dist'
shutil.rmtree(dist, ignore_errors=True)
os.makedirs(f'{dist}/artifact'); os.makedirs(f'{dist}/HealthHub/icons')

# artifact build: no PWA head tags
art = re.sub(r'<!--PWA-->.*?<!--/PWA-->\n?', '', src, flags=re.S).replace('%%BUILD%%', 'artifact')
open(f'{dist}/artifact/index.html', 'w').write(art)

# installable build
pwa = src.replace('<!--PWA-->\n', '').replace('<!--/PWA-->\n', '').replace('%%BUILD%%', 'pwa')
open(f'{dist}/HealthHub/index.html', 'w').write(pwa)

manifest = {
  "name": "Health Hub", "short_name": "Health Hub", "id": "./", "start_url": "./", "scope": "./",
  "display": "standalone", "orientation": "portrait", "background_color": "#0e0f11", "theme_color": "#0e0f11",
  "icons": [
    {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
    {"src": "icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ]
}
open(f'{dist}/HealthHub/manifest.webmanifest', 'w').write(json.dumps(manifest, indent=2))

sw = """// Health Hub service worker: network first, cache fallback (works offline, picks up updates when online)
const CACHE = 'healthhub-v3';
const ASSETS = ['./', './index.html', './config.js', './vendor/supabase.js', './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // no-cache = always ask GitHub if there's a newer version (cheap 304 when unchanged), fall back to the saved copy offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
"""
open(f'{dist}/HealthHub/sw.js', 'w').write(sw)
shutil.copy(f'{ROOT}/config.js', f'{dist}/HealthHub/config.js')
shutil.copytree(f'{ROOT}/vendor', f'{dist}/HealthHub/vendor')

def icon(size, maskable=False):
    S = 1024
    im = Image.new('RGB', (S, S), '#0e0f11')
    d = ImageDraw.Draw(im)
    if not maskable:
        d.rounded_rectangle([0, 0, S, S], radius=0, fill='#121417')
    inset = 0.22 if maskable else 0.16
    x0, x1 = S*inset, S*(1-inset)
    y0, y1 = S*(inset+0.04), S*(1-inset-0.02)
    # goal line (dashed, orange)
    gx0, gy0, gx1, gy1 = x0, y0 + (y1-y0)*0.12, x1, y0 + (y1-y0)*0.86
    n = 9
    for i in range(n):
        if i % 2: continue
        a = i/n; b = (i+1)/n
        d.line([gx0+(gx1-gx0)*a, gy0+(gy1-gy0)*a, gx0+(gx1-gx0)*b, gy0+(gy1-gy0)*b], fill='#e0782f', width=int(S*0.035))
    # weight line (blue), wobbling down
    pts = [(0.0,0.05),(0.14,0.16),(0.27,0.10),(0.42,0.33),(0.56,0.30),(0.71,0.55),(0.85,0.60),(1.0,0.80)]
    P = [(x0+(x1-x0)*a, y0+(y1-y0)*b) for a,b in pts]
    d.line(P, fill='#3987e5', width=int(S*0.06), joint='curve')
    r = S*0.05
    lx, ly = P[-1]
    d.ellipse([lx-r, ly-r, lx+r, ly+r], fill='#3987e5', outline='#0e0f11', width=int(S*0.02))
    return im.resize((size, size), Image.LANCZOS)

icon(180).save(f'{dist}/HealthHub/icons/apple-touch-icon.png')
icon(192).save(f'{dist}/HealthHub/icons/icon-192.png')
icon(512).save(f'{dist}/HealthHub/icons/icon-512.png')
icon(512, True).save(f'{dist}/HealthHub/icons/icon-512-maskable.png')

readme = """HEALTH HUB - put it on your iPhone
====================================

The app has to live at a web address once, then you add it to your Home Screen.
It then opens full-screen like a normal app and works offline.

1. Unzip this file on your computer (you get a folder called HealthHub).
2. Go to https://app.netlify.com/drop and sign up free (an account keeps the site online).
3. Drag the whole HealthHub folder onto the page. Netlify gives you a link like
   https://something-123.netlify.app (you can rename it in Site settings).
4. On your iPhone, open that link in Safari -> tap Share -> "Add to Home Screen" -> Add.
5. Open Health Hub from the Home Screen icon from now on (not from Safari),
   because data saved in the Home Screen app is kept separate from Safari.

Your data stays on your iPhone. Use Settings (gear icon) -> "Save backup file" now and then.
To update the app later, drag the new HealthHub folder onto the same Netlify site
(Deploys -> drag and drop). Your data is kept.
"""
open(f'{dist}/HealthHub/HOW-TO-INSTALL.txt', 'w').write(readme)

zp = f'{dist}/HealthHub-iPhone-app.zip'
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(f'{dist}/HealthHub'):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, dist))
# site files at the repo root (served by GitHub Pages)
shutil.copy(f'{dist}/HealthHub/index.html', f'{ROOT}/index.html')
shutil.copy(f'{dist}/HealthHub/manifest.webmanifest', f'{ROOT}/manifest.webmanifest')
shutil.copy(f'{dist}/HealthHub/sw.js', f'{ROOT}/sw.js')
shutil.rmtree(f'{ROOT}/icons', ignore_errors=True)
shutil.copytree(f'{dist}/HealthHub/icons', f'{ROOT}/icons')
print('built', os.path.getsize(f'{dist}/artifact/index.html'), 'bytes;', zp)

import os, re, shutil, zipfile, json
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(f'{ROOT}/src/app.html').read()
# exercise library: src/exercises.txt -> compact JSON array injected into the page
lib = []
for line in open(f'{ROOT}/src/exercises.txt'):
    line = line.strip()
    if not line or line.startswith('#'): continue
    n, e, m, sec, t = [x.strip() for x in line.split('|')]
    lib.append([n, e, m, sec, t])
assert '/*%%EXERCISES%%*/[]' in src
src = src.replace('/*%%EXERCISES%%*/[]', json.dumps(lib, separators=(',', ':')))
dist = f'{ROOT}/dist'
shutil.rmtree(dist, ignore_errors=True)
os.makedirs(f'{dist}/artifact'); os.makedirs(f'{dist}/HealthHub/icons')

import base64
def b64(path): return base64.b64encode(open(path, 'rb').read()).decode()
FACES = [("Archivo Variable", "archivo-wdth.woff2", "font-weight:100 900;font-stretch:62% 125%"),
         ("Inter Variable", "inter-wght.woff2", "font-weight:100 900")]
def fontface(inline):
    out = []
    for fam, f, extra in FACES:
        url = ('data:font/woff2;base64,' + b64(f'{ROOT}/fonts/{f}')) if inline else f'fonts/{f}'
        out.append("@font-face{font-family:'%s';font-style:normal;font-display:swap;%s;src:url(%s) format('woff2-variations'),url(%s) format('woff2')}" % (fam, extra, url, url))
    return '\n'.join(out)
src = src.replace('%%LOGIN_HERO%%', 'data:image/jpeg;base64,' + b64(f'{ROOT}/img/login-hero.jpg'))

# artifact build: no PWA head tags
art = re.sub(r'<!--PWA-->.*?<!--/PWA-->\n?', '', src, flags=re.S).replace('%%BUILD%%', 'artifact').replace('/*%%FONTFACE%%*/', fontface(True))
open(f'{dist}/artifact/index.html', 'w').write(art)

# installable build
pwa = src.replace('<!--PWA-->\n', '').replace('<!--/PWA-->\n', '').replace('%%BUILD%%', 'pwa').replace('/*%%FONTFACE%%*/', fontface(False))
open(f'{dist}/HealthHub/index.html', 'w').write(pwa)

manifest = {
  "name": "Health Hub", "short_name": "Health Hub", "id": "./", "start_url": "./", "scope": "./",
  "display": "standalone", "orientation": "portrait", "background_color": "#0F2D52", "theme_color": "#0F2D52",
  "icons": [
    {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
    {"src": "icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ]
}
open(f'{dist}/HealthHub/manifest.webmanifest', 'w').write(json.dumps(manifest, indent=2))

sw = """// Health Hub service worker: network first, cache fallback (works offline, picks up updates when online)
const CACHE = 'healthhub-v6';
const ASSETS = ['./', './index.html', './config.js', './vendor/supabase.js', './fonts/archivo-wdth.woff2', './fonts/inter-wght.woff2', './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
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
shutil.copytree(f'{ROOT}/fonts', f'{dist}/HealthHub/fonts')

def icon(size, maskable=False):
    # rendered from the brand board by tools/make-icons.mjs (brand font, Egyptian Blue tile, red dot)
    src = Image.open(f'{ROOT}/img/' + ('icon-maskable-src.png' if maskable else 'icon-src.png')).convert('RGB')
    return src.resize((size, size), Image.LANCZOS)

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

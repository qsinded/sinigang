// Offline cache. The app is static, so the whole shell is precached on install and served from the
// cache first; the network is only used for files this list does not name.
// Bump VERSION when a shipped file changes, or phones keep running the old copy.
const VERSION = 'v12';
const CACHE = 'reviewer-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/reviewer-generator.js',
  './js/pptx-reader.js',
  './js/app.js',
  './js/sw-register.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];
// Fetched with the shell but not required for install: 1.5 MB of PDF.js is only useful for PDFs,
// and a failed fetch here must not leave the app with no offline copy at all.
const OPTIONAL = ['./js/pdfjs-viewer-bundle.js', './js/pdfjs-worker-bundle.js'];
// A page load is answered with the cached document, so a deep link still opens offline.
const isPage = req => req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await Promise.all(OPTIONAL.map(f => cache.add(f).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Drop every older version, so a fixed bug cannot stay cached on a phone.
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // the app talks to nothing else, and never proxies
  // Cache keys are written the same way as SHELL ('./css/styles.css'), so a precached file and a
  // runtime request for it always land on one entry. The query string is dropped: a static file
  // cannot answer differently because of it.
  const base = self.registration.scope;
  const rel = './' + url.pathname.slice(new URL(base).pathname.length) + url.search.replace(/\?.*/, '');
  const key = isPage(req) ? './index.html' : url.href.startsWith(base) ? rel : url.href;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Keep what a later offline visit may need: the shell's own files, including a PDF.js bundle
      // loaded on demand, and anything the manifest names.
      if (res.ok && res.type === 'basic') await cache.put(key, res.clone());
      return res;
    } catch (e) {
      // Offline and not cached: a page load still gets the app, a missing file gets a plain 504.
      const shell = await cache.match('./index.html');
      if (shell && isPage(req)) return shell;
      return new Response('Offline and not cached.', { status: 504, statusText: 'Offline' });
    }
  })());
});

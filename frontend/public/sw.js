// EduSched service worker: keeps the app shell (HTML, hashed assets, fonts, icons) for offline use.
// Timetable data is not cached here: the app keeps the last-seen weeks in localStorage and says how old they are.
const CACHE = 'edusched-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/fonts/ibm-plex-sans-latin-400-normal.woff2', '/fonts/ibm-plex-sans-latin-500-normal.woff2', '/fonts/ibm-plex-sans-latin-600-normal.woff2', '/fonts/ibm-plex-mono-latin-400-normal.woff2', '/fonts/ibm-plex-mono-latin-500-normal.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // Precache the entry assets the HTML points at.
      const html = await (await cache.match('/')).text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await cache.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// The page sends the lazily loaded chunks it used, so they are there offline too.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === 'string' && u.startsWith('/assets/'));
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(urls)).catch(() => undefined));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Network first so a deploy shows up at once; the cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === '/') caches.open(CACHE).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(async () => (await caches.match('/')) || Response.error()),
    );
    return;
  }

  if (/^\/(assets|fonts|icons)\//.test(url.pathname) || url.pathname === '/favicon.svg') {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

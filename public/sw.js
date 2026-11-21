/* AMANAT AI service worker (OFF-1): the shell, prompts and icons are precached, so the citizen app opens and
 * plays its voice prompts with no network. Hand-written (see docs/progress/PROMPT-1.md: Serwist deviation).
 * - precache: citizen shell pages, manifest, icon and every clip in /voice/ur/manifest.json
 * - /_next/static/*: cache-first (content-hashed, immutable)
 * - /voice/*: cache-first
 * - navigations: network-first, falling back to the cached page, then to the cached citizen shell
 * - /api/*: never cached (personal data stays out of the cache; the outbox handles offline writes)
 */
const VERSION = 'amanat-v2';
const SHELL = ['/c', '/h', '/offline', '/manifest.webmanifest', '/icon.svg', '/voice/ur/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    try {
      const manifest = await (await fetch('/voice/ur/manifest.json')).json();
      // core prompts at install (shell, questions, digits); the rest are cached the first time they play
      await cache.addAll(manifest.clips.filter((c) => c.precache).map((c) => c.file));
    } catch (e) { /* clips are also cached on first use */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

// the page sends the static assets it already loaded before this worker took control
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter((u) => typeof u === 'string' && u.startsWith(self.location.origin) && !u.includes('/api/'));
  event.waitUntil(caches.open(VERSION).then((c) => Promise.all(urls.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/voice/') || url.pathname === '/icon.svg') {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: req.url.includes('/voice/') });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok && new URL(req.url).pathname.startsWith('/c')) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('/c')) || (await cache.match('/offline')) || Response.error();
  }
}

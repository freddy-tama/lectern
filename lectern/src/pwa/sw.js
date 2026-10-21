// Lectern's service worker. It keeps the app shell (the page, scripts, styles, fonts and icons)
// so Lectern opens without a connection. Decks and pictures already live in IndexedDB.
//
// The build fills in VERSION and PRECACHE (see serviceWorker() in vite.config.ts), so every
// deploy ships a different file. The browser installs it next to the running one; the page then
// offers "Reload", which sends 'skip-waiting' (src/app/pwa.ts).
//
// Never handled here: /api/* (AI and picture helpers), other sites, anything but GET.

const VERSION = '__LECTERN_VERSION__';
const PRECACHE = /* __LECTERN_PRECACHE__ */ [];
const PREFIX = 'lectern-shell-';
const CACHE = PREFIX + VERSION;
const SHELL = '/index.html';
/** Bigger files are left to the network rather than kept. */
const MAX_BYTES = 8 * 1024 * 1024;
// Servers can add "Vary: Origin", and module scripts are requested with an Origin header the
// kept copy wasn't, so a plain match would miss. These files are the same for every request.
const MATCH = { ignoreVary: true };

/** 'shell' serves the kept page, 'asset' answers from the cache first, 'pass' leaves it to the browser. */
function route(request) {
  if (request.method !== 'GET' || request.headers.has('range')) return 'pass';
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return 'pass';
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return 'pass';
  if (request.mode === 'navigate') {
    // Files opened directly (a sample picture, the manifest) are not pages of the app.
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/samples/') || /\.[a-z0-9]+$/i.test(url.pathname)) return 'pass';
    return 'shell';
  }
  if (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)) return 'asset';
  return 'pass';
}

/** A response that can be kept: same-site, complete and not redirected. */
async function keepable(response) {
  if (!response.ok || response.status !== 200 || response.type === 'opaque') return null;
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: 200, statusText: response.statusText, headers: response.headers });
}

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(PRECACHE.map(async (path) => {
    // Hashed files the last version already kept are copied instead of downloaded again.
    if (path.startsWith('/assets/')) {
      const kept = await caches.match(path, MATCH);
      if (kept) return cache.put(path, kept);
    }
    const response = await keepable(await fetch(new Request(path, { cache: 'reload' })));
    if (!response) throw new Error(`Could not keep ${path}`);
    await cache.put(path, response);
  }));
}

async function fromShell(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(SHELL, MATCH);
  return kept || fetch(request);
}

async function fromCache(request) {
  const kept = await caches.match(request, MATCH);
  if (kept) return kept;
  const response = await fetch(request);
  const url = new URL(request.url);
  const size = Number(response.headers.get('content-length') || 0);
  if (response.ok && response.status === 200 && url.pathname.startsWith('/assets/') && !url.pathname.endsWith('.wasm') && size <= MAX_BYTES) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only Lectern's own shell caches: other caches (such as transformers.js models) stay.
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const kind = route(event.request);
  if (kind === 'shell') event.respondWith(fromShell(event.request));
  else if (kind === 'asset') event.respondWith(fromCache(event.request));
});

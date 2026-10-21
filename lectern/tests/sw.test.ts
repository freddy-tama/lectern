// @vitest-environment node
// Runs src/pwa/sw.js, the file the build turns into dist/sw.js, against a small fake of the
// Cache API and of the service worker's events.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://lectern.test';
const TEMPLATE = readFileSync(new URL('../src/pwa/sw.js', import.meta.url), 'utf8');

const keyOf = (request: Request | string) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;

/** Keeps the Vary header's rule: a match needs the same Origin header unless ignoreVary is set. */
class FakeCache {
  entries = new Map<string, Response>();
  origins = new Map<string, string | null>();
  async put(request: Request | string, response: Response) {
    this.entries.set(keyOf(request), response.clone());
    this.origins.set(keyOf(request), typeof request === 'string' ? null : request.headers.get('origin'));
  }
  async match(request: Request | string, options: CacheQueryOptions = {}) {
    const key = keyOf(request);
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    const origin = typeof request === 'string' ? null : request.headers.get('origin');
    if (!options.ignoreVary && /origin/i.test(hit.headers.get('vary') ?? '') && origin !== this.origins.get(key)) return undefined;
    return hit.clone();
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() { return [...this.stores.keys()]; }
  async delete(name: string) { return this.stores.delete(name); }
  async match(request: Request | string, options?: CacheQueryOptions) {
    for (const store of this.stores.values()) {
      const hit = await store.match(request, options);
      if (hit) return hit;
    }
    return undefined;
  }
  /** Every URL kept, in any cache. */
  urls() { return [...this.stores.values()].flatMap((s) => [...s.entries.keys()]); }
}

type Handler = (event: unknown) => void;

function startWorker({ version = 'v2', precache = ['/index.html', '/assets/index-abc.js', '/assets/app-abc.css', '/icons/icon-192.png'], caches = new FakeCaches(), online = true } = {}) {
  const source = TEMPLATE
    .replace("'__LECTERN_VERSION__'", JSON.stringify(version))
    .replace('/* __LECTERN_PRECACHE__ */ []', JSON.stringify(precache));
  const handlers: Record<string, Handler> = {};
  const self = {
    location: new URL('/sw.js', ORIGIN),
    addEventListener: (type: string, handler: Handler) => { handlers[type] = handler; },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
  };
  const network = { online };
  const fetch = vi.fn(async (input: Request | string) => {
    if (!network.online) throw new TypeError('Failed to fetch');
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
    if (url.pathname === '/missing.js') return new Response('nope', { status: 404 });
    // Like vite preview, which adds "Vary: Origin" to every file.
    return new Response(`body of ${url.pathname}`, { status: 200, headers: { 'content-type': 'text/plain', vary: 'Origin' } });
  });
  // In a worker, relative URLs resolve against the worker's own address.
  const WorkerRequest = class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) { super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init); }
  };
  new Function('self', 'caches', 'fetch', 'Request', source)(self, caches, fetch, WorkerRequest);

  const lifecycle = async (type: 'install' | 'activate') => {
    let wait: Promise<unknown> = Promise.resolve();
    handlers[type]({ waitUntil: (p: Promise<unknown>) => { wait = p; } });
    await wait;
  };
  /** Sends a request through the worker: null when it leaves the request to the browser. */
  const request = async (path: string, { mode, ...init }: RequestInit & { mode?: RequestMode } = {}) => {
    const req = new Request(new URL(path, ORIGIN), init);
    // Node's Request refuses mode 'navigate', so the event carries a stand-in for it.
    const forWorker = mode === 'navigate' ? { mode, url: req.url, method: req.method, headers: req.headers } : req;
    let answer: Promise<Response> | null = null;
    handlers.fetch({ request: forWorker, respondWith: (p: Promise<Response>) => { answer = p; } });
    return answer ? await (answer as Promise<Response>) : null;
  };
  return { self, caches, fetch, network, lifecycle, request, handlers };
}

describe('service worker', () => {
  it('keeps every app file on install, bypassing the HTTP cache', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    expect(await sw.caches.keys()).toEqual(['lectern-shell-v2']);
    expect(sw.caches.urls().sort()).toEqual([
      `${ORIGIN}/assets/app-abc.css`, `${ORIGIN}/assets/index-abc.js`, `${ORIGIN}/icons/icon-192.png`, `${ORIGIN}/index.html`,
    ]);
    const requests = sw.fetch.mock.calls.map(([r]) => r as Request);
    expect(requests.every((r) => r.cache === 'reload')).toBe(true);
  });

  it('fails the install when a file is missing, so the old version stays', async () => {
    const sw = startWorker({ precache: ['/index.html', '/missing.js'] });
    await expect(sw.lifecycle('install')).rejects.toThrow(/missing\.js/);
  });

  it('copies hashed files the last version already kept instead of downloading them', async () => {
    const caches = new FakeCaches();
    const old = await caches.open('lectern-shell-v1');
    await old.put('/assets/index-abc.js', new Response('kept'));
    const sw = startWorker({ caches });
    await sw.lifecycle('install');
    const fetched = sw.fetch.mock.calls.map(([r]) => new URL((r as Request).url).pathname);
    expect(fetched).not.toContain('/assets/index-abc.js');
    expect(fetched).toContain('/index.html');
    expect(await (await (await caches.open('lectern-shell-v2')).match('/assets/index-abc.js'))!.text()).toBe('kept');
  });

  it('never touches /api requests', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    expect(await sw.request('/api/draft-deck', { method: 'POST', body: '{}' })).toBeNull();
    expect(await sw.request('/api/picture-search?q=tide')).toBeNull();
    expect(await sw.request('/api/revise-slide')).toBeNull();
    expect(await sw.request('/api')).toBeNull();
    expect(await sw.request('/api/picture-search', { mode: 'navigate' })).toBeNull();
    expect(sw.caches.urls().some((u) => u.includes('/api'))).toBe(false);
  });

  it('opens every app page from the kept shell, even offline', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    sw.network.online = false;
    for (const path of ['/', '/studio/d_123', '/decks', '/join/ABCD', '/settings#your-data']) {
      const response = await sw.request(path, { mode: 'navigate' });
      expect(await response!.text()).toBe('body of /index.html');
    }
  });

  it('serves kept scripts to module imports, which send an Origin header', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    sw.network.online = false;
    // Node lets a Request carry Origin; browsers add it to every module script request.
    const response = await sw.request('/assets/index-abc.js', { headers: { origin: ORIGIN } });
    expect(await response!.text()).toBe('body of /assets/index-abc.js');
  });

  it('serves app files from the cache, and keeps new hashed files the first time', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    sw.fetch.mockClear();
    expect(await (await sw.request('/assets/index-abc.js'))!.text()).toBe('body of /assets/index-abc.js');
    expect(sw.fetch).not.toHaveBeenCalled();

    await sw.request('/assets/Studio-xyz.js');
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(sw.caches.urls()).toContain(`${ORIGIN}/assets/Studio-xyz.js`));
    sw.network.online = false;
    expect(await (await sw.request('/assets/Studio-xyz.js'))!.text()).toBe('body of /assets/Studio-xyz.js');
  });

  it('leaves other sites, other methods, ranges and opened files to the browser', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    expect(await sw.request('https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json')).toBeNull();
    expect(await sw.request('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort.wasm')).toBeNull();
    expect(await sw.request('/assets/index-abc.js', { method: 'HEAD' })).toBeNull();
    expect(await sw.request('/assets/clip.mp4', { headers: { range: 'bytes=0-' } })).toBeNull();
    expect(await sw.request('/samples/nest.svg', { mode: 'navigate' })).toBeNull();
    expect(await sw.request('/manifest.webmanifest', { mode: 'navigate' })).toBeNull();
    expect(await sw.request('/robots.txt')).toBeNull();
  });

  it('doesn’t keep the ONNX WebAssembly', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    await sw.request('/assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm');
    await new Promise((r) => setTimeout(r, 10));
    expect(sw.caches.urls().some((u) => u.endsWith('.wasm'))).toBe(false);
  });

  it('on activate removes older Lectern caches only, then takes over open pages', async () => {
    const caches = new FakeCaches();
    await caches.open('lectern-shell-v1');
    await caches.open('transformers-cache');
    const sw = startWorker({ caches });
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    expect((await caches.keys()).sort()).toEqual(['lectern-shell-v2', 'transformers-cache']);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it('switches to the new version only when the page asks', () => {
    const sw = startWorker();
    sw.handlers.message({ data: { type: 'hello' } });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.handlers.message({ data: { type: 'skip-waiting' } });
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig, loadEnv } from 'vite';

const VIRTUAL = 'virtual:lectern-plugins';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Mods are picked at build time from LECTERN_PLUGINS (comma separated folder
 * names under /plugins). The public build sets nothing, so no mod code ships.
 */
function lecternPlugins(): Plugin {
  const ids = (process.env.LECTERN_PLUGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]+$/.test(s));
  return {
    name: 'lectern-plugins',
    resolveId(id) {
      return id === VIRTUAL ? `\0${VIRTUAL}` : undefined;
    },
    load(id) {
      if (id !== `\0${VIRTUAL}`) return undefined;
      const imports = ids.map((p, i) => `import p${i} from '/plugins/${p}/index.ts';`).join('\n');
      return `${imports}\nexport default [${ids.map((_, i) => `p${i}`).join(', ')}];\n`;
    },
  };
}

const SITE_DECKS = 'virtual:lectern-site-decks';
const SITE_DECK = 'virtual:lectern-site-deck/';

/**
 * Decks a site ships to every browser that opens it. LECTERN_SITE_DECKS names a folder of
 * deck files (*.lectern.json, from Export ▸ Deck file). Each file becomes its own chunk, which
 * only a browser without that copy loads; see src/data/site-decks.ts. Unset, nothing ships.
 */
function siteDecks(): Plugin {
  const dir = process.env.LECTERN_SITE_DECKS?.trim();
  const files = dir && existsSync(dir)
    ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.lectern.json')).sort().map((f) => join(dir, f))
    : [];
  if (dir && !files.length) console.warn(`LECTERN_SITE_DECKS: no .lectern.json files in ${dir}`);
  const entry = (file: string, i: number) => {
    const text = readFileSync(file, 'utf8');
    let deck: { id?: unknown } | undefined;
    try {
      const parsed = JSON.parse(text) as { format?: unknown; deck?: { id?: unknown } };
      if (parsed.format === 'lectern-deck') deck = parsed.deck;
    } catch { /* reported below */ }
    if (!deck) throw new Error(`LECTERN_SITE_DECKS: ${file} isn't a Lectern deck file.`);
    const id = typeof deck.id === 'string' && /^[\w-]{1,80}$/.test(deck.id) ? deck.id : `file-${i + 1}`;
    const version = createHash('sha256').update(text).digest('hex').slice(0, 16);
    return `{ id: ${JSON.stringify(id)}, version: ${JSON.stringify(version)}, load: () => import(${JSON.stringify(`${SITE_DECK}site-deck-${i}`)}) }`;
  };
  return {
    name: 'lectern-site-decks',
    resolveId(id) {
      return id === SITE_DECKS || id.startsWith(SITE_DECK) ? `\0${id}` : undefined;
    },
    load(id) {
      if (id === `\0${SITE_DECKS}`) return `export default [${files.map(entry).join(',\n')}];\n`;
      if (!id.startsWith(`\0${SITE_DECK}`)) return undefined;
      const file = files[Number(/site-deck-(\d+)$/.exec(id)?.[1] ?? -1)];
      return file ? `export default ${JSON.stringify(readFileSync(file, 'utf8'))};\n` : undefined;
    },
  };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Serves /api/*.ts (Vercel-style functions with Web Request/Response) during local development. */
function devApi(): Plugin {
  return {
    name: 'lectern-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const name = /^\/api\/([a-z-]+)(?:\?.*)?$/.exec(url)?.[1];
        if (!name) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const method = (req.method ?? 'GET').toUpperCase();
          const handler = mod[method] as ((r: Request) => Promise<Response>) | undefined;
          if (!handler) {
            res.statusCode = 405;
            res.end('Method not allowed');
            return;
          }
          const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const response = await handler(new Request(`http://localhost${url}`, { method, headers, body: body ? new Uint8Array(body) : undefined }));
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          // Streamed as it comes, so event streams (the deck assistant's step cards) arrive live, as on Vercel.
          const reader = response.body?.getReader();
          for (;;) {
            const chunk = reader ? await reader.read() : { done: true as const, value: undefined };
            if (chunk.done) break;
            res.write(chunk.value);
          }
          res.end();
        } catch (error) {
          server.config.logger.error(String(error));
          res.statusCode = 500;
          res.end('API error');
        }
      });
    },
  };
}

/** Files the service worker keeps for offline use: the page and everything it loads, not the big ONNX WebAssembly. */
const SHELL_FILE = /\.(?:m?js|css|woff2?|png|svg|ico|webmanifest)$/;
const SHELL_MAX_BYTES = 3 * 1024 * 1024;

/**
 * The dev server's sw.js. Development has no offline copy, and a worker left on this address by
 * a production preview would keep serving that old build, so this one removes itself and it.
 */
const DEV_SERVICE_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('lectern-shell-')) await caches.delete(name);
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
})()));
`;

/**
 * Writes dist/sw.js from src/pwa/sw.js, with the list of files to keep and a version made from
 * their contents. Any change to the app gives a new sw.js, which is how browsers notice a deploy.
 */
function serviceWorker(): Plugin {
  let build = false;
  let root = '';
  let outDir = '';
  let log: (message: string) => void = () => {};
  return {
    name: 'lectern-service-worker',
    configResolved(config) {
      build = config.command === 'build';
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
      log = (message) => config.logger.info(message);
    },
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(DEV_SERVICE_WORKER);
      });
    },
    closeBundle() {
      if (!build || !existsSync(join(outDir, 'index.html'))) return;
      const template = readFileSync(resolve(root, 'src/pwa/sw.js'), 'utf8');
      const files = (readdirSync(outDir, { recursive: true }) as string[])
        .map((f) => f.replace(/\\/g, '/'))
        .filter((f) => f === 'index.html' || (f !== 'sw.js' && SHELL_FILE.test(f)))
        .filter((f) => statSync(join(outDir, f)).isFile() && statSync(join(outDir, f)).size <= SHELL_MAX_BYTES)
        .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
      const hash = createHash('sha256').update(template);
      for (const f of files) hash.update(`\0${f}\0`).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const source = template
        .replace("'__LECTERN_VERSION__'", JSON.stringify(version))
        .replace('/* __LECTERN_PRECACHE__ */ []', JSON.stringify(files.map((f) => `/${f}`)));
      if (source.includes('__LECTERN_')) throw new Error('src/pwa/sw.js lost its __LECTERN_VERSION__ or __LECTERN_PRECACHE__ placeholder');
      writeFileSync(join(outDir, 'sw.js'), source);
      log(`sw.js ${version}: keeps ${files.length} files for offline use`);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make .env.local values (for example ANTHROPIC_API_KEY) visible to the local API.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
  return {
    plugins: [react(), lecternPlugins(), siteDecks(), devApi(), serviceWorker()],
    // The app's version, shown in the front page's footer.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { port: 5180, host: '127.0.0.1' },
    // The transcription worker imports transformers.js. Pre-bundle it at start-up so the dev
    // server doesn't discover it mid-session and reload the page during a transcription.
    optimizeDeps: { include: ['@huggingface/transformers'] },
    build: { chunkSizeWarningLimit: 1200 },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
      // Some suites load parsers or the export engine up front, which is slow when every file runs at once.
      hookTimeout: 30_000,
    },
  };
});

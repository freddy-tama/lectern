/// <reference types="vitest/config" />
import type { IncomingMessage } from 'node:http';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig, loadEnv } from 'vite';

const VIRTUAL = 'virtual:lectern-plugins';

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
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(String(error));
          res.statusCode = 500;
          res.end('API error');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make .env.local values (for example ANTHROPIC_API_KEY) visible to the local API.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
  return {
    plugins: [react(), lecternPlugins(), devApi()],
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

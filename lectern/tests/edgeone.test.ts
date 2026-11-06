// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_ROUTES, ROUTES, agentRequest, fromAgent, fromCloud, serve, shareEnv } from '../server/edgeone';
// @ts-expect-error plain JavaScript edge function, without type declarations
import { forward, passedHeaders, upstreamUrl } from '../edge-functions/hf/[[default]].js';
import { resetRelayCache } from '../api/ice';
import { aiStatus, requestId } from '../src/features/account/session';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const names = (dir: string) => readdirSync(new URL(dir, import.meta.url)).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, '')).sort();

describe('EdgeOne Makers routes', () => {
  afterEach(() => {
    delete process.env.TURN_URLS;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    resetRelayCache();
  });

  it('serves every route in api/, each from exactly one kind of function', () => {
    const api = names('../api/');
    expect(Object.keys(ROUTES).sort()).toEqual(api);
    const cloud = names('../cloud-functions/api/');
    const agents = names('../agents/api/');
    expect([...cloud, ...agents].sort()).toEqual(api);
    expect(agents).toEqual([...AGENT_ROUTES].sort());
    for (const name of cloud) expect(read(`../cloud-functions/api/${name}.ts`)).toContain(`fromCloud('${name}', context)`);
    for (const name of agents) expect(read(`../agents/api/${name}.ts`)).toContain(`fromAgent('${name}', context)`);
  });

  it('runs every route Vercel gives more than 120 s as an Agents function', () => {
    const vercel = JSON.parse(read('../vercel.json')) as { functions: Record<string, { maxDuration: number }> };
    const long = Object.entries(vercel.functions).filter(([, f]) => f.maxDuration > 120).map(([file]) => file.replace(/^api\/|\.ts$/g, '')).sort();
    expect([...AGENT_ROUTES].sort()).toEqual(long);
    const makers = JSON.parse(read('../edgeone.json')) as {
      cloudFunctions: { maxDuration: number; regions: { overseas: string[]; mainland?: string[] } };
      agents: { timeout: number };
    };
    expect(makers.cloudFunctions.maxDuration).toBeLessThanOrEqual(120);
    expect(makers.agents.timeout).toBeGreaterThanOrEqual(Math.max(...Object.values(vercel.functions).map((f) => f.maxDuration)));
    // AI providers don't serve Hong Kong or the mainland: the functions must run elsewhere.
    expect(makers.cloudFunctions.regions.overseas).toEqual(['ap-singapore']);
    expect(makers.cloudFunctions.regions.mainland).toBeUndefined();
  });

  it('calls the route’s handler for the method, and answers unknown routes and methods plainly', async () => {
    const res = await serve('ice', new Request('https://lectern.example.com/api/ice'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ iceServers: [], relay: false });
    expect((await serve('nope', new Request('https://lectern.example.com/api/nope'))).status).toBe(404);
    expect((await serve('toString', new Request('https://lectern.example.com/api/toString'))).status).toBe(404);
    const wrong = await serve('ice', new Request('https://lectern.example.com/api/ice', { method: 'POST', body: '{}' }));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET');
  });

  it('hands the project’s settings to the routes, without overriding what’s there', async () => {
    const env = { TURN_URLS: 'turn:relay.example.com:3478', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p', NOT_TEXT: 3 };
    const res = await fromCloud('ice', { request: new Request('https://lectern.example.com/api/ice'), env });
    expect(await res.json()).toMatchObject({ relay: true });
    expect(process.env.NOT_TEXT).toBeUndefined();
    const target: Record<string, string | undefined> = { A: 'kept' };
    shareEnv({ A: 'new', B: 'added' }, target);
    expect(target).toEqual({ A: 'kept', B: 'added' });
  });
});

describe('Agents function requests', () => {
  it('rebuilds a Request from a parsed body and plain headers, keeping the sent length', async () => {
    const abort = new AbortController();
    const req = agentRequest({
      method: 'post',
      url: 'https://lectern.example.com/api/draft-deck?x=1',
      headers: { 'content-type': 'application/json', 'content-length': '5000000', 'x-lectern-code': 'sesame', accept: ['a', 'b'], skipped: undefined },
      body: { topic: 'Moon phases', n: 3 },
      signal: abort.signal,
    });
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://lectern.example.com/api/draft-deck?x=1');
    expect(req.headers.get('x-lectern-code')).toBe('sesame');
    expect(req.headers.get('content-length')).toBe('5000000');
    expect(req.headers.get('accept')).toBe('a, b');
    expect(await req.json()).toEqual({ topic: 'Moon phases', n: 3 });
    abort.abort();
    expect(req.signal.aborted).toBe(true);
  });

  it('sends no body with a GET, passes text through, and adds JSON’s type when missing', async () => {
    const get = agentRequest({ method: 'GET', url: 'https://lectern.example.com/api/draft-deck', headers: {}, body: { ignored: true } });
    expect(get.body).toBeNull();
    const text = agentRequest({ method: 'POST', url: 'https://lectern.example.com/api/x', headers: { 'content-type': 'text/plain' }, body: 'hello' });
    expect(await text.text()).toBe('hello');
    const json = agentRequest({ method: 'POST', url: 'https://lectern.example.com/api/x', body: [1, 2] });
    expect(json.headers.get('content-type')).toBe('application/json');
    expect(await json.json()).toEqual([1, 2]);
  });

  it('uses a standard Request as it is', () => {
    const request = new Request('https://lectern.example.com/api/teleprompter');
    expect(agentRequest(request)).toBe(request);
  });

  it('serves a long route end to end, and says when a route needs a key', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await fromAgent('draft-deck', { request: { method: 'GET', url: 'https://lectern.example.com/api/draft-deck', headers: {} }, env: {} });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ available: false });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('the browser’s request id', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is what Agents functions accept, and new for every request', () => {
    const ids = new Set(Array.from({ length: 50 }, () => requestId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-zA-Z_.-]{6,36}$/);
  });

  it('still works without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {});
    const id = requestId();
    expect(id).toMatch(/^[0-9a-zA-Z_.-]{6,36}$/);
    expect(id.startsWith('lectern-')).toBe(true);
  });

  it('goes with the AI routes’ status checks', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await aiStatus('/api/draft-deck');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/draft-deck');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['makers-conversation-id']).toMatch(/^[0-9a-zA-Z_.-]{6,36}$/);
  });
});

describe('Hugging Face forward for speech models', () => {
  it('passes only the Whisper model files Lectern uses', () => {
    expect(upstreamUrl('/hf/onnx-community/whisper-base/resolve/main/config.json')).toBe('https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json');
    expect(upstreamUrl('/hf/onnx-community/whisper-small/resolve/main/onnx/decoder_model_merged_q4.onnx')).toContain('/onnx/decoder_model_merged_q4.onnx');
    expect(upstreamUrl('/hf/someone/else/resolve/main/config.json')).toBeNull();
    expect(upstreamUrl('/hf/onnx-community/whisper-base/resolve/main/../../../api/whoami-v2')).toBeNull();
    expect(upstreamUrl('/hf/onnx-community/whisper-base/blob/main/config.json')).toBeNull();
  });

  it('streams the file on, with its type and length', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response('{"model_type":"whisper"}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': '24', 'set-cookie': 'x=1' } });
    };
    const res = await forward(new Request('https://lectern.example.com/hf/onnx-community/whisper-base/resolve/main/config.json', { headers: { range: 'bytes=0-9' } }), fetcher);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"model_type":"whisper"}');
    expect(res.headers.get('content-length')).toBe('24');
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(seen[0]).toMatchObject({ url: 'https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json', init: { redirect: 'follow', headers: { range: 'bytes=0-9' } } });
  });

  it('drops the length of a body that arrives decompressed', () => {
    const h = passedHeaders(new Response('x', { headers: { 'content-length': '10', 'content-encoding': 'gzip' } }));
    expect(h.get('content-length')).toBeNull();
  });

  it('refuses other methods and unknown paths, and reports an unreachable upstream', async () => {
    expect((await forward(new Request('https://lectern.example.com/hf/onnx-community/whisper-base/resolve/main/config.json', { method: 'POST', body: 'x' }))).status).toBe(405);
    expect((await forward(new Request('https://lectern.example.com/hf/elsewhere/x/resolve/main/a.json'))).status).toBe(404);
    const down = async () => { throw new TypeError('fetch failed'); };
    expect((await forward(new Request('https://lectern.example.com/hf/onnx-community/whisper-base/resolve/main/config.json'), down)).status).toBe(502);
  });
});

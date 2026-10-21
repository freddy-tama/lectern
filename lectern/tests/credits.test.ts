// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admit, bearer, charge, chargeDollars, dailyCap, supabaseSettings } from '../api/_lib/account';
import { geminiUsage, openAiUsage } from '../api/picture-generate';
import { START_CREDITS, callDollars, pictureDollars, toCredits } from '../src/core/ai/prices';

describe('prices', () => {
  it('prices a call at the model’s list rate', () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache reads, $5 cache writes per million tokens.
    expect(callDollars({ model: 'claude-opus-5-5', input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheWrite: 200_000 })).toBeCloseTo(4 + 2 + 0.1 + 1);
    // A dated model id still finds its row.
    expect(callDollars({ model: 'claude-haiku-4-5-20251001', input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(1);
  });

  it('charges an unknown model at the dearest rate, unless asked to be strict', () => {
    const u = { model: 'claude-unknown-9', input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
    expect(callDollars(u)).toBeCloseTo(50);
    expect(callDollars(u, true)).toBeNull();
  });

  it('turns dollars into credits, rounding up to a thousandth', () => {
    expect(toCredits(20)).toBe(START_CREDITS);
    expect(toCredits(0.005)).toBe(1);
    expect(toCredits(0.0000001)).toBe(0.001);
    expect(toCredits(0)).toBe(0);
    expect(toCredits(-1)).toBe(0);
    expect(toCredits(Number.NaN)).toBe(0);
  });

  it('prices pictures by their tokens, with a fixed charge when the service reports none', () => {
    const sunburst = { model: 'gpt-image-2.5-sunburst', textIn: 1_000_000, imageIn: 0, textOut: 0, imageOut: 1_000_000 };
    expect(pictureDollars(sunburst, 'gpt-image-2.5-sunburst')).toBeCloseTo(35);
    expect(pictureDollars(null, 'gpt-image-2.5-sunburst')).toBe(0.1);
    expect(pictureDollars({ ...sunburst, textIn: 0, imageOut: 0 }, 'gpt-image-2.5-sunburst')).toBe(0.1);
    expect(pictureDollars(null, 'gemini-3.1-flash-image-preview')).toBe(0.07);
    // A model missing from the table pays for the dearest picture.
    expect(pictureDollars(null, 'some-new-image-model')).toBe(0.1);
  });

  it('reads the picture services’ usage', () => {
    expect(openAiUsage({ input_tokens: 50, output_tokens: 4000, input_tokens_details: { text_tokens: 40, image_tokens: 10 } }, 'gpt-image-2.5-sunburst'))
      .toEqual({ model: 'gpt-image-2.5-sunburst', textIn: 40, imageIn: 10, textOut: 0, imageOut: 4000 });
    expect(openAiUsage({ input_tokens: 50, output_tokens: 4000 }, 'gpt-image-1-mini')).toMatchObject({ textIn: 50, imageIn: 0, imageOut: 4000 });
    expect(openAiUsage(undefined, 'gpt-image-1-mini')).toBeNull();
    expect(geminiUsage({ promptTokenCount: 30, candidatesTokenCount: 1300, thoughtsTokenCount: 200, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }, { modality: 'TEXT', tokenCount: 10 }] }, 'gemini-3.1-flash-image'))
      .toEqual({ model: 'gemini-3.1-flash-image', textIn: 30, imageIn: 0, textOut: 210, imageOut: 1290 });
    // No breakdown: all of the answer counts as picture, the dearer rate.
    expect(geminiUsage({ promptTokenCount: 30, candidatesTokenCount: 1300 }, 'gemini-3.1-flash-image')).toMatchObject({ textOut: 0, imageOut: 1300 });
  });
});

describe('server settings', () => {
  it('turns accounts on only with a URL, a public key and a secret key', () => {
    const env = { SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', SUPABASE_SECRET_KEY: 'sb_secret_y' };
    expect(supabaseSettings(env)).toEqual({ url: 'https://abc.supabase.co', publicKey: 'sb_publishable_x', secretKey: 'sb_secret_y' });
    expect(supabaseSettings({ ...env, SUPABASE_SECRET_KEY: '' })).toBeNull();
    expect(supabaseSettings({ ...env, SUPABASE_URL: 'http://abc.supabase.co' })).toBeNull();
    expect(supabaseSettings({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'eyJrole' }))
      .toEqual({ url: 'https://abc.supabase.co', publicKey: 'anon', secretKey: 'eyJrole' });
    expect(supabaseSettings({})).toBeNull();
  });

  it('reads the daily cap, defaulting to the starting grant', () => {
    expect(dailyCap({})).toBe(START_CREDITS);
    expect(dailyCap({ LECTERN_DAILY_CREDITS: '12000' })).toBe(12000);
    expect(dailyCap({ LECTERN_DAILY_CREDITS: '0' })).toBe(0);
    expect(dailyCap({ LECTERN_DAILY_CREDITS: 'lots' })).toBe(START_CREDITS);
  });

  it('reads the sign-in token from the Authorization header', () => {
    expect(bearer(new Request('https://x.test', { headers: { authorization: 'Bearer abc.def' } }))).toBe('abc.def');
    expect(bearer(new Request('https://x.test', { headers: { authorization: 'Basic abc' } }))).toBe('');
    expect(bearer(new Request('https://x.test'))).toBe('');
  });
});

describe('admitting and charging AI requests', () => {
  const settings = { url: 'https://abc.supabase.co', publicKey: 'pk', secretKey: 'sb_secret_y' };
  let sent: { url: string; headers: Record<string, string>; body: unknown }[];
  let user: { id: string; email: string } | null;
  let status: { balance: number; spent_today: number };
  let spendFails: boolean;

  beforeEach(() => {
    sent = [];
    user = { id: '11111111-1111-1111-1111-111111111111', email: 'ada@example.com' };
    status = { balance: 4000, spent_today: 0 };
    spendFails = false;
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      sent.push({ url: String(url), headers, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith('/auth/v1/user')) return user && headers.authorization === 'Bearer good' ? Response.json(user) : Response.json({ msg: 'bad jwt' }, { status: 401 });
      if (String(url).endsWith('/rpc/lectern_credit_status')) return Response.json([status]);
      if (String(url).endsWith('/rpc/lectern_spend')) return spendFails ? new Response('down', { status: 500 }) : Response.json(3999.5);
      return new Response('not found', { status: 404 });
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const ask = (token = 'good') => new Request('https://lectern.test/api/draft-deck', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });

  async function refusal(result: unknown) {
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    return { status: res.status, ...(await res.json() as { code: string; error: string }) };
  }

  it('lets everything through when accounts are off', async () => {
    expect(await admit(ask(''), null)).toBeNull();
    expect(sent).toEqual([]);
  });

  it('asks someone without a sign-in, or with a bad one, to sign in', async () => {
    expect(await refusal(await admit(ask(''), settings))).toMatchObject({ status: 401, code: 'sign_in' });
    expect(await refusal(await admit(ask('forged'), settings))).toMatchObject({ status: 401, code: 'sign_in' });
    // The token was checked with Supabase, never the credits.
    expect(sent.some((s) => s.url.includes('/rpc/'))).toBe(false);
  });

  it('admits a signed-in person with credits, and says who they are', async () => {
    expect(await admit(ask(), settings)).toEqual({ userId: user!.id, balance: 4000 });
    const check = sent.find((s) => s.url.endsWith('/rpc/lectern_credit_status'))!;
    expect(check.body).toEqual({ p_user: user!.id, p_start: START_CREDITS });
    // The server's own calls use the secret key; the user's token goes only to the auth check.
    expect(check.headers.apikey).toBe('sb_secret_y');
    expect(check.headers.authorization).toBeUndefined();
  });

  it('refuses someone whose credits are used up', async () => {
    status = { balance: 0, spent_today: 0 };
    expect(await refusal(await admit(ask(), settings))).toMatchObject({ status: 402, code: 'no_credits' });
    status = { balance: -0.4, spent_today: 0 };
    expect(await refusal(await admit(ask(), settings))).toMatchObject({ status: 402, code: 'no_credits' });
  });

  it('refuses everyone once the site reaches its daily cap', async () => {
    status = { balance: 300, spent_today: 4000 };
    expect(await refusal(await admit(ask(), settings))).toMatchObject({ status: 429, code: 'daily_cap' });
    vi.stubEnv('LECTERN_DAILY_CREDITS', '0');
    expect(await admit(ask(), settings)).toMatchObject({ balance: 300 });
  });

  it('says so when the credits can’t be checked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await refusal(await admit(ask(), settings))).toMatchObject({ status: 503, code: 'credits_unavailable' });
  });

  it('charges what the calls cost, in credits', async () => {
    const caller = { userId: user!.id, balance: 4000 };
    const usage = [{ model: 'claude-opus-5-5', input: 10_000, output: 2_000, cacheRead: 0, cacheWrite: 0 }];
    expect(await charge(caller, 'draft-deck:slides', usage, settings)).toBe(3999.5);
    const spend = sent.find((s) => s.url.endsWith('/rpc/lectern_spend'))!;
    // $0.04 + $0.04 = $0.08, which is 16 credits.
    expect(spend.body).toEqual({ p_user: caller.userId, p_credits: 16, p_endpoint: 'draft-deck:slides', p_detail: usage, p_start: START_CREDITS });
  });

  it('charges nothing without a caller, and never throws when charging fails', async () => {
    expect(await charge(null, 'draft-deck', [{ model: 'claude-opus-5-5', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }], settings)).toBeNull();
    expect(sent).toEqual([]);
    const caller = { userId: user!.id, balance: 12 };
    // Nothing spent: no call to Supabase.
    expect(await chargeDollars(caller, 'picture-generate', 0, {}, settings)).toBe(12);
    expect(sent).toEqual([]);
    spendFails = true;
    expect(await chargeDollars(caller, 'picture-generate', 0.1, {}, settings)).toBeNull();
  });

  it('sends a legacy service-role key in Authorization as well', async () => {
    await chargeDollars({ userId: user!.id, balance: 1 }, 'x', 0.01, {}, { ...settings, secretKey: 'eyJhbGciOi.legacy' });
    expect(sent[0]!.headers).toMatchObject({ apikey: 'eyJhbGciOi.legacy', authorization: 'Bearer eyJhbGciOi.legacy' });
  });
});

describe('AI endpoints with accounts on', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'pk');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_y');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('LECTERN_ACCESS_CODE', '');
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ msg: 'no token' }, { status: 401 });
      throw new Error(`unexpected call to ${String(url)}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ['draft-deck', { topic: 'Volcanoes', mode: 'outline' }],
    ['deck-questions', { topic: 'Volcanoes' }],
    ['revise-slide', { mode: 'rewrite' }],
    ['make-code', { mode: 'html', request: 'A clock' }],
    ['lecture-notes', { transcript: 'Hello' }],
    ['picture-generate', { prompt: 'A volcano', shape: 'wide' }],
    ['deck-assistant', { deck: {}, messages: [] }],
  ])('%s asks a signed-out person to sign in before calling any AI', async (name, body) => {
    const { POST } = await import(`../api/${name}.ts`) as { POST: (r: Request) => Promise<Response> };
    const send = (headers: Record<string, string>) => POST(new Request(`https://lectern.test/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
    for (const res of [await send({}), await send({ authorization: 'Bearer expired' })]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'sign_in' });
    }
    // Only the expired sign-in was checked: no Claude, OpenAI or Gemini call.
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(['https://abc.supabase.co/auth/v1/user']);
  });
});

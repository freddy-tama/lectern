// Accounts on the server: who is asking for AI, whether they may, and charging them for it.
// Not a route: Vercel skips files whose names start with an underscore.
//
// Accounts are on when the Supabase settings below are in the environment. Then every AI request
// needs a signed-in person with credits left, and what it really cost (tokens × the model's list
// price) comes off their balance. Without them, AI works as before, behind LECTERN_ACCESS_CODE
// if one is set, and nothing is charged.
//
// Environment:
//   SUPABASE_URL                                         the project's URL
//   SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY        the public key browsers sign in with
//   SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY     the secret key the server spends credits with
//   LECTERN_DAILY_CREDITS   optional cap on the credits everyone together may spend in a UTC day
//                           (default 4000, which is $20; 0 turns the cap off)
//
// The tables and functions this calls are in supabase/schema.sql.

import type Anthropic from '@anthropic-ai/sdk';
import { type CallUsage, START_CREDITS, callDollars, toCredits } from '../../src/core/ai/prices.js';

export interface SupabaseSettings {
  url: string;
  publicKey: string;
  secretKey: string;
}

const first = (...values: (string | undefined)[]) => values.map((v) => v?.trim()).find(Boolean) ?? '';

export function supabaseSettings(env: Record<string, string | undefined> = process.env): SupabaseSettings | null {
  const url = first(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
  const publicKey = first(env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_ANON_KEY, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const secretKey = first(env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY);
  if (!/^https:\/\/\S+$/.test(url) || !publicKey || !secretKey) return null;
  return { url, publicKey, secretKey };
}

export function dailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LECTERN_DAILY_CREDITS?.trim();
  if (!raw) return START_CREDITS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : START_CREDITS;
}

/** The person asking, with the credits they had when the request began. */
export interface Caller {
  userId: string;
  balance: number;
}

function refuse(error: string, code: string, status: number) {
  return new Response(JSON.stringify({ error, code }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/** The sign-in token a request carries, from "Authorization: Bearer …". */
export function bearer(request: Request): string {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return m ? m[1]! : '';
}

/** Headers for the server's own calls to Supabase. A legacy service-role key is a JWT and also goes in Authorization. */
function serverHeaders(s: SupabaseSettings): Record<string, string> {
  return {
    apikey: s.secretKey,
    ...(s.secretKey.startsWith('eyJ') ? { authorization: `Bearer ${s.secretKey}` } : {}),
    'content-type': 'application/json',
  };
}

/** Who a sign-in token belongs to, or null when it's missing, expired or forged. Supabase checks it. */
export async function userFor(s: SupabaseSettings, token: string): Promise<{ id: string; email: string } | null> {
  if (!token) return null;
  const res = await fetch(`${s.url}/auth/v1/user`, {
    headers: { apikey: s.publicKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Supabase auth returned ${res.status}`);
  const user = await res.json() as { id?: unknown; email?: unknown };
  return typeof user.id === 'string' && user.id ? { id: user.id, email: typeof user.email === 'string' ? user.email : '' } : null;
}

let methods: { at: number; value: Promise<{ github: boolean; email: boolean }> } | null = null;

/** Which ways to sign in the Supabase project has turned on, read from its public settings for five minutes at a time. */
export function signInMethods(s: SupabaseSettings, now = Date.now()): Promise<{ github: boolean; email: boolean }> {
  if (!methods || now - methods.at > 300_000) {
    const value = fetch(`${s.url}/auth/v1/settings`, { headers: { apikey: s.publicKey }, signal: AbortSignal.timeout(5_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Supabase settings returned ${r.status}`))))
      .then((j: { external?: Record<string, unknown> }) => ({ github: j.external?.github === true, email: j.external?.email !== false }))
      // Unknown: offer both, and let Supabase say if one is off.
      .catch(() => ({ github: true, email: true }));
    methods = { at: now, value };
  }
  return methods.value;
}

async function rpc(s: SupabaseSettings, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${s.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serverHeaders(s),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Supabase ${name} returned ${res.status}`);
  return res.json();
}

/** A person's balance, opening their account with the starting credits the first time, and what everyone spent today. */
export async function creditStatus(s: SupabaseSettings, userId: string): Promise<{ balance: number; spentToday: number }> {
  const rows = await rpc(s, 'lectern_credit_status', { p_user: userId, p_start: START_CREDITS });
  const row = (Array.isArray(rows) ? rows[0] : rows) as { balance?: unknown; spent_today?: unknown } | undefined;
  return { balance: Number(row?.balance ?? START_CREDITS), spentToday: Number(row?.spent_today ?? 0) };
}

/**
 * Lets an AI request through, or says why not. Returns the caller (null when accounts are off),
 * or a response to send instead: 401 to sign in, 402 when the credits are used up, 429 when the
 * site has reached its daily cap, 503 when the credits can't be checked.
 */
export async function admit(request: Request, settings = supabaseSettings()): Promise<Caller | null | Response> {
  if (!settings) return null;
  try {
    const user = await userFor(settings, bearer(request));
    if (!user) return refuse('Sign in to use AI. Every account starts with 4,000 free AI credits.', 'sign_in', 401);
    const { balance, spentToday } = await creditStatus(settings, user.id);
    if (balance <= 0) return refuse('You’ve used all your AI credits.', 'no_credits', 402);
    const cap = dailyCap();
    if (cap > 0 && spentToday >= cap) return refuse('Lectern’s AI has reached its limit for today. Try again tomorrow.', 'daily_cap', 429);
    return { userId: user.id, balance };
  } catch (error) {
    console.error('Checking AI credits failed', error);
    return refuse('Lectern couldn’t check your AI credits just now. Try again in a minute.', 'credits_unavailable', 503);
  }
}

/** Takes credits for what a request spent. Never throws: a failed charge is logged, and the answer still goes out. */
export async function chargeDollars(caller: Caller | null, endpoint: string, dollars: number, detail: unknown, settings = supabaseSettings()): Promise<number | null> {
  if (!caller || !settings) return null;
  const credits = toCredits(dollars);
  if (!credits) return caller.balance;
  try {
    const left = await rpc(settings, 'lectern_spend', { p_user: caller.userId, p_credits: credits, p_endpoint: endpoint, p_detail: detail, p_start: START_CREDITS });
    return Number(left);
  } catch (error) {
    console.error(`Charging ${credits} credits for ${endpoint} failed`, error);
    return null;
  }
}

/** Takes credits for the tokens one or more Claude calls used. */
export function charge(caller: Caller | null, endpoint: string, usage: CallUsage[], settings = supabaseSettings()): Promise<number | null> {
  const dollars = usage.reduce((sum, u) => sum + (callDollars(u) ?? 0), 0);
  return chargeDollars(caller, endpoint, dollars, usage, settings);
}

/** Tokens one call used, per model. A refusal fallback can add a second model's attempt. */
export function usageOf(response: Pick<Anthropic.Beta.BetaMessage, 'model' | 'usage'>): CallUsage[] {
  const u = response.usage as Anthropic.Beta.BetaMessage['usage'] | undefined;
  // Every real answer reports its usage; one that doesn't is charged nothing rather than failing.
  if (!u) return [];
  const entry = (model: string | null | undefined, e: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): CallUsage => ({
    model: model || response.model,
    input: e.input_tokens ?? 0,
    output: e.output_tokens ?? 0,
    cacheRead: e.cache_read_input_tokens ?? 0,
    cacheWrite: e.cache_creation_input_tokens ?? 0,
  });
  // With a fallback, each attempt is listed in iterations; the top-level figures cover only the last.
  const attempts = (u.iterations ?? []).filter((it) => it.type === 'message' || it.type === 'fallback_message');
  if (attempts.length) return attempts.map((it) => entry('model' in it ? it.model : null, it));
  return [entry(response.model, u)];
}

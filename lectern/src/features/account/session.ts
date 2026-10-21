// The signed-in person, when this server has accounts: their sign-in, their AI credits, and the
// headers every AI request carries. Accounts are off unless the server has Supabase settings
// (api/account.ts says which); then nothing here loads Supabase and AI works as it always has.

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';

export interface AccountConfig {
  accounts: boolean;
  url?: string;
  key?: string;
  startCredits?: number;
  /** The ways to sign in that the Supabase project has turned on. */
  github?: boolean;
  email?: boolean;
}

export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

export type AccountState =
  | { status: 'loading' }
  | { status: 'off' }
  | { status: 'signed-out' }
  /** `credits` is null until the balance has been read. */
  | { status: 'signed-in'; user: AccountUser; credits: number | null };

let state: AccountState = { status: 'loading' };
const listeners = new Set<() => void>();

function setState(next: AccountState) {
  state = next;
  listeners.forEach((l) => l());
}

export const accountState = () => state;

export function onAccountChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAccount(): AccountState {
  useEffect(() => { void startAccount(); }, []);
  return useSyncExternalStore(onAccountChange, accountState, accountState);
}

let config: Promise<AccountConfig> | null = null;

/** Asks the server whether it has accounts. Cached for the visit. */
export function accountConfig(): Promise<AccountConfig> {
  config ??= fetch('/api/account')
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : { accounts: false }))
    .then((j: AccountConfig) => (j.accounts && typeof j.url === 'string' && typeof j.key === 'string'
      ? { accounts: true, url: j.url, key: j.key, startCredits: Number(j.startCredits) || 4000, github: j.github !== false, email: j.email !== false }
      : { accounts: false }))
    .catch(() => ({ accounts: false }));
  return config;
}

let client: Promise<SupabaseClient | null> | null = null;

/** Supabase's browser client, loaded only when the server has accounts. */
export function supabase(): Promise<SupabaseClient | null> {
  client ??= accountConfig().then(async (c) => {
    if (!c.accounts || !c.url || !c.key) return null;
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(c.url, c.key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }).catch(() => null);
  return client;
}

function userOf(session: Session): AccountUser {
  const u = session.user;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name, meta.user_name].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  return { id: u.id, email: u.email ?? '', name: name ?? u.email ?? 'Signed in' };
}

function applySession(session: Session | null) {
  if (!session) {
    setState({ status: 'signed-out' });
    return;
  }
  const user = userOf(session);
  const credits = state.status === 'signed-in' && state.user.id === user.id ? state.credits : null;
  setState({ status: 'signed-in', user, credits });
  // Supabase asks that its own calls wait until its sign-in callback has returned.
  setTimeout(() => void refreshCredits(), 0);
}

let started: Promise<void> | null = null;

/** Starts following the sign-in. Runs once, when the app starts. */
export function startAccount(): Promise<void> {
  started ??= supabase().then(async (sb) => {
    if (!sb) { setState({ status: 'off' }); return; }
    const { data } = await sb.auth.getSession();
    applySession(data.session);
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;
      applySession(session);
    });
  }).catch(() => setState({ status: 'off' }));
  return started;
}

/** The current sign-in token, or '' when no one is signed in or accounts are off. */
export async function accessToken(): Promise<string> {
  const sb = await supabase();
  if (!sb) return '';
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? '';
}

/** Reads the signed-in person's balance from the server. */
export async function refreshCredits(): Promise<void> {
  const token = await accessToken();
  if (!token) return;
  try {
    const res = await fetch('/api/account', { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json() as { credits?: unknown };
    if (state.status === 'signed-in' && typeof body.credits === 'number') setState({ ...state, credits: body.credits });
  } catch {
    // The balance shows again after the next AI request.
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Reads the balance again shortly, after an AI request has been charged. */
export function refreshCreditsSoon() {
  if (state.status !== 'signed-in') return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshCredits(), 400);
}

const CODE_KEY = 'lectern.aiCode';

/** The access code this server asked for, as the person last typed it. */
export function savedCode(): string {
  try { return localStorage.getItem(CODE_KEY) ?? ''; } catch { return ''; }
}

export function saveCode(code: string) {
  try { localStorage.setItem(CODE_KEY, code); } catch { /* private mode */ }
}

/** Headers for an AI request: JSON, the server's access code if one was entered, and the sign-in. */
export async function aiHeaders(): Promise<Record<string, string>> {
  const token = await accessToken().catch(() => '');
  return { 'content-type': 'application/json', 'x-lectern-code': savedCode(), ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

/** POSTs an AI request with the right headers, and reads the balance again once it's answered. */
export async function aiPost(url: string, body: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { method: 'POST', headers: await aiHeaders(), body, signal });
  refreshCreditsSoon();
  return res;
}

export type AiAccess = 'ok' | 'loading' | 'sign_in' | 'no_credits';

/** Whether this person may use the server's AI. Says nothing about whether the server has AI. */
export function aiAccess(s: AccountState): AiAccess {
  if (s.status === 'loading') return 'loading';
  if (s.status === 'signed-out') return 'sign_in';
  if (s.status === 'signed-in' && s.credits !== null && s.credits <= 0) return 'no_credits';
  return 'ok';
}

export function useAiAccess(): AiAccess {
  return aiAccess(useAccount());
}

const NEXT_KEY = 'lectern.signInNext';

/** Where to go back to after signing in: a path in this app, never another site. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?!\/)[^\s\\]*$/.test(next) && !next.startsWith('/signin') ? next : '/';
}

export async function signInWithGitHub(next: string): Promise<string | null> {
  const sb = await supabase();
  if (!sb) return 'Accounts aren’t set up on this server.';
  try { sessionStorage.setItem(NEXT_KEY, safeNext(next)); } catch { /* private mode */ }
  const { error } = await sb.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: `${location.origin}/signin` } });
  return error ? error.message : null;
}

export async function signInWithEmail(email: string, next: string): Promise<string | null> {
  const sb = await supabase();
  if (!sb) return 'Accounts aren’t set up on this server.';
  try { sessionStorage.setItem(NEXT_KEY, safeNext(next)); } catch { /* private mode */ }
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/signin`, shouldCreateUser: true } });
  return error ? error.message : null;
}

/** Where the person was going before they left to sign in, read once. */
export function takeSignInNext(): string {
  try {
    const next = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return safeNext(next);
  } catch {
    return '/';
  }
}

export async function signOut(): Promise<void> {
  const sb = await supabase();
  if (!sb) return;
  await sb.auth.signOut();
}

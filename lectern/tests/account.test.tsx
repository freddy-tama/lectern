import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyMark } from '../src/data/db';

// A stand-in for Supabase's browser client: a session to hand out, a study_marks table, and a record of calls.
const supa = vi.hoisted(() => ({
  session: null as null | { access_token: string; user: { id: string; email: string; user_metadata: Record<string, unknown> } },
  rows: [] as Record<string, unknown>[],
  calls: [] as [string, ...unknown[]][],
  listeners: [] as ((event: string, session: unknown) => void)[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: unknown) => {
    supa.calls.push(['createClient', url, key, options]);
    const announce = (event: string) => supa.listeners.forEach((l) => l(event, supa.session));
    return {
      auth: {
        getSession: async () => ({ data: { session: supa.session }, error: null }),
        onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
          supa.listeners.push(listener);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        signInWithOtp: async (args: unknown) => { supa.calls.push(['signInWithOtp', args]); return { error: null }; },
        signInWithOAuth: async (args: unknown) => { supa.calls.push(['signInWithOAuth', args]); return { error: null }; },
        signOut: async () => { supa.calls.push(['signOut']); supa.session = null; announce('SIGNED_OUT'); return { error: null }; },
      },
      from: (table: string) => ({
        select: () => ({
          range: async (from: number, to: number) => ({ data: supa.rows.slice(from, to + 1), error: null }),
        }),
        upsert: async (rows: Record<string, unknown>[], options: unknown) => {
          supa.calls.push(['upsert', table, rows, options]);
          for (const row of rows) {
            const at = supa.rows.findIndex((r) => r.deck_id === row.deck_id && r.slide_id === row.slide_id);
            if (at >= 0) supa.rows[at] = row; else supa.rows.push(row);
          }
          return { error: null };
        },
      }),
    };
  },
}));

const ADA = { id: 'user-ada', email: 'ada@example.com', user_metadata: { full_name: 'Ada Lovelace' } };
const ON = { accounts: true, url: 'https://abc.supabase.co', key: 'sb_publishable_x', startCredits: 4000, github: true, email: true, signedIn: false };

let root: Root | null = null;
let host: HTMLDivElement;
let calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
let credits = 4000;

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

/** A fresh visit: new modules, the server's answers, and who is signed in. */
async function server(config: Record<string, unknown>, session: typeof supa.session = null, ai = true) {
  vi.resetModules();
  calls = [];
  supa.session = session;
  supa.calls = [];
  supa.listeners = [];
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: String(url), method, headers, body: String(init?.body ?? '') });
    if (String(url) === '/api/account') return Response.json(headers.authorization ? { signedIn: true, credits } : config);
    if (String(url) === '/api/draft-deck' && method === 'GET') return Response.json({ available: ai });
    return Response.json({ error: 'Offline' }, { status: 503 });
  }));
  const { db } = await import('../src/data/db');
  await Promise.all(db.tables.map((t) => t.clear()));
  return db;
}

async function render(element: React.ReactElement, path: string) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const { ToastProvider } = await import('../src/ui/Toast');
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(ToastProvider, null, element)));
  });
  await settle();
}

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await act(() => new Promise((r) => setTimeout(r, 10)));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  credits = 4000;
  supa.rows = [];
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.unstubAllGlobals();
});

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...host.querySelectorAll<T>(sel)];
const text = () => host.textContent ?? '';
const byText = (sel: string, label: string) => $$(sel).find((el) => el.textContent?.trim() === label);

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const mark = (deckId: string, slideId: string, status: StudyMark['status'], updatedAt: number): StudyMark => ({ deckId, slideId, status, updatedAt });

describe('who may use AI', () => {
  it('follows the account: loading, off, signed out, signed in, out of credits', async () => {
    const { aiAccess } = await import('../src/features/account/session');
    expect(aiAccess({ status: 'loading' })).toBe('loading');
    expect(aiAccess({ status: 'off' })).toBe('ok');
    expect(aiAccess({ status: 'signed-out' })).toBe('sign_in');
    const user = { id: 'u', email: '', name: 'U' };
    expect(aiAccess({ status: 'signed-in', user, credits: null })).toBe('ok');
    expect(aiAccess({ status: 'signed-in', user, credits: 0.5 })).toBe('ok');
    expect(aiAccess({ status: 'signed-in', user, credits: 0 })).toBe('no_credits');
    expect(aiAccess({ status: 'signed-in', user, credits: -2 })).toBe('no_credits');
  });

  it('goes back only to a page of this app after signing in', async () => {
    const { safeNext } = await import('../src/features/account/session');
    expect(safeNext('/make?x=1')).toBe('/make?x=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('/signin?next=/make')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('the sign-in page', () => {
  it('says accounts aren’t set up when the server has none, and loads no Supabase', async () => {
    await server({ accounts: false });
    const { default: SignInPage } = await import('../src/features/account/SignInPage');
    await render(createElement(SignInPage), '/signin');
    expect(text()).toContain('Accounts aren’t set up on this copy of Lectern. Everything here works without signing in.');
    expect(supa.calls).toEqual([]);
  });

  it('offers GitHub and an emailed link, and checks the address before sending', async () => {
    await server(ON);
    const { default: SignInPage } = await import('../src/features/account/SignInPage');
    await render(createElement(SignInPage), '/signin?next=%2Fmake');
    expect($('h1')?.textContent).toBe('Sign in to use AI');
    expect(text()).toContain('Every account starts with 4,000 free AI credits.');
    expect(supa.calls[0]).toEqual(['createClient', ON.url, ON.key, { auth: expect.objectContaining({ flowType: 'pkce', detectSessionInUrl: true }) }]);

    const input = $<HTMLInputElement>('input[type="email"]')!;
    await type(input, 'ada');
    await act(async () => (byText('button', 'Email me a sign-in link') as HTMLButtonElement).click());
    expect($('[role="alert"]')?.textContent).toContain('Enter an email address, like name@example.com.');
    expect(supa.calls.some(([fn]) => fn === 'signInWithOtp')).toBe(false);

    await type(input, ' ada@example.com ');
    await act(async () => (byText('button', 'Email me a sign-in link') as HTMLButtonElement).click());
    await settle();
    expect(supa.calls.find(([fn]) => fn === 'signInWithOtp')?.[1]).toEqual({ email: 'ada@example.com', options: { emailRedirectTo: `${location.origin}/signin`, shouldCreateUser: true } });
    expect($('[role="status"]')?.textContent).toContain('Check your email. We sent a sign-in link to ada@example.com.');
    expect(sessionStorage.getItem('lectern.signInNext')).toBe('/make');

    await act(async () => (byText('button', 'Continue with GitHub') as HTMLButtonElement).click());
    await settle();
    expect(supa.calls.find(([fn]) => fn === 'signInWithOAuth')?.[1]).toEqual({ provider: 'github', options: { redirectTo: `${location.origin}/signin` } });
  });

  it('leaves out GitHub when the project hasn’t turned it on', async () => {
    await server({ ...ON, github: false });
    const { default: SignInPage } = await import('../src/features/account/SignInPage');
    await render(createElement(SignInPage), '/signin');
    expect(byText('button', 'Continue with GitHub')).toBeUndefined();
    expect(byText('button', 'Email me a sign-in link')).toBeDefined();
  });

  it('shows who is signed in and their credits, and signs out', async () => {
    credits = 3987.6;
    await server(ON, { access_token: 'token-ada', user: ADA });
    const { default: SignInPage } = await import('../src/features/account/SignInPage');
    const { AccountNavLink } = await import('../src/features/account/AccountUi');
    await render(createElement('div', null, createElement(AccountNavLink), createElement(SignInPage)), '/signin');
    expect($('h1')?.textContent).toBe('You’re signed in');
    expect(text()).toContain('As Ada Lovelace (ada@example.com).');
    expect($('[data-testid="credits-left"]')?.textContent).toBe('3,987');
    expect($('[data-testid="nav-account"]')?.textContent).toContain('3,987');
    // The balance was read with the sign-in token.
    expect(calls.find((c) => c.headers.authorization)?.headers.authorization).toBe('Bearer token-ada');

    await act(async () => (byText('button', 'Sign out') as HTMLButtonElement).click());
    await settle();
    expect(supa.calls.some(([fn]) => fn === 'signOut')).toBe(true);
    expect($('h1')?.textContent).toBe('Sign in to use AI');
    expect($('[data-testid="nav-sign-in"]')?.getAttribute('href')).toBe('/signin');
  });
});

describe('making a deck with accounts on', () => {
  async function visitMake(session: typeof supa.session) {
    await server(ON, session);
    const { registerCoreKinds } = await import('../src/core/kinds/core-kinds');
    registerCoreKinds();
    const { default: MakePage } = await import('../src/features/autodeck/MakePage');
    await render(createElement(MakePage), '/make');
  }
  const makeButton = () => byText('button', 'Make the deck') as HTMLButtonElement;

  it('asks a signed-out person to sign in, and drafts nothing from a topic alone', async () => {
    await visitMake(null);
    const notice = $('[data-testid="ai-sign-in"]');
    expect(notice?.textContent).toContain('Sign in to draft decks with AI.');
    expect(notice?.querySelector('a')?.getAttribute('href')).toBe('/signin?next=%2Fmake');
    expect(byText('a', 'Start from notes')?.getAttribute('href')).toBe('/decks?new=notes');
    expect(text()).not.toContain('Lectern drafts from that');

    await type($<HTMLTextAreaElement>('.ad-brief textarea')!, 'Why small teams ship faster');
    await act(async () => makeButton().click());
    await settle();
    expect($('[role="alert"]')?.textContent).toContain('Sign in to draft a deck from a topic alone. Or start from your notes, or add a file.');
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('says when the credits are used up', async () => {
    credits = 0;
    await visitMake({ access_token: 'token-ada', user: ADA });
    expect($('[data-testid="ai-no-credits"]')?.textContent).toContain('You’ve used all your AI credits.');
    expect($('[data-testid="ai-sign-in"]')).toBeNull();
  });

  it('sends a signed-in person’s requests with their sign-in', async () => {
    await visitMake({ access_token: 'token-ada', user: ADA });
    expect($('[data-testid="ai-sign-in"]')).toBeNull();
    expect(text()).toContain('No files? Describe the topic here and Lectern drafts from that.');
    await type($<HTMLTextAreaElement>('.ad-brief textarea')!, 'Why small teams ship faster');
    await act(async () => makeButton().click());
    await settle();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) expect(post.headers.authorization).toBe('Bearer token-ada');
  });
});

describe('study progress per person', () => {
  it('keeps the newer mark for each slide, both ways', async () => {
    const { mergeMarks } = await import('../src/features/account/study-sync');
    const local = [mark('d', 'a', 'known', 5), mark('d', 'b', 'learning', 1), mark('d', 'c', 'known', 7)];
    const remote = [mark('d', 'a', 'learning', 3), mark('d', 'b', 'known', 4), mark('e', 'a', 'learning', 2)];
    const { toLocal, toRemote } = mergeMarks(local, remote);
    expect(toLocal).toEqual([mark('d', 'b', 'known', 4), mark('e', 'a', 'learning', 2)]);
    expect(toRemote).toEqual([mark('d', 'a', 'known', 5), mark('d', 'c', 'known', 7)]);
    expect(mergeMarks(local, local)).toEqual({ toLocal: [], toRemote: [] });
  });

  it('brings marks in on sign-in, saves new ones, and clears them from the browser on sign-out', async () => {
    const db = await server(ON, { access_token: 'token-ada', user: ADA });
    await db.study.bulkPut([mark('d', 'a', 'known', 5), mark('d', 'b', 'learning', 1)]);
    supa.rows = [{ deck_id: 'd', slide_id: 'b', status: 'known', updated_at: 4 }, { deck_id: 'e', slide_id: 'a', status: 'learning', updated_at: 2 }];
    const { startStudySync, saveMark } = await import('../src/features/account/study-sync');
    const { startAccount, signOut } = await import('../src/features/account/session');
    startStudySync();
    await startAccount();
    await settle();

    const here = (await db.study.toArray()).map((m) => `${m.deckId}/${m.slideId}:${m.status}`).sort();
    expect(here).toEqual(['d/a:known', 'd/b:known', 'e/a:learning']);
    const up = supa.calls.filter(([fn]) => fn === 'upsert');
    expect(up).toHaveLength(1);
    expect(up[0]![2]).toEqual([{ user_id: ADA.id, deck_id: 'd', slide_id: 'a', status: 'known', updated_at: 5 }]);
    expect(up[0]![3]).toEqual({ onConflict: 'user_id,deck_id,slide_id' });

    await saveMark(mark('e', 'a', 'known', 9));
    expect(supa.rows.find((r) => r.deck_id === 'e')).toMatchObject({ status: 'known', updated_at: 9 });

    await signOut();
    await settle();
    expect(await db.study.count()).toBe(0);
    // Signed out, a new mark stays in this browser only.
    const before = supa.calls.length;
    await saveMark(mark('d', 'a', 'learning', 10));
    expect(await db.study.count()).toBe(1);
    expect(supa.calls.length).toBe(before);
  });
});

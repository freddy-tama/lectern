import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import TrySample from '../src/app/TrySample';
import { SAMPLES, VIEWS, tryHref } from '../src/app/try-samples';
import { db } from '../src/data/db';
import { defaultProfile, getProfile, saveProfile } from '../src/data/profile';
import { ensureSampleDeck, seedOnce } from '../src/data/repo';
import { buildSeed } from '../src/data/seed';
import { ctaTarget } from '../src/features/landing/Cta';
import Onboarding from '../src/features/onboarding/Onboarding';
import { pageName, resolveNext, safeNext } from '../src/features/onboarding/next';
import { ToastProvider } from '../src/ui/Toast';

describe('where /start goes next', () => {
  it('follows only paths on this site that are not /start', () => {
    expect(safeNext('/decks')).toBe('/decks');
    expect(safeNext('/studio/deck_meetings_talk?x=1')).toBe('/studio/deck_meetings_talk?x=1');
    expect(safeNext('/')).toBe('/');
    expect(safeNext(null)).toBeNull();
    expect(safeNext('')).toBeNull();
    expect(safeNext('decks')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('/start')).toBeNull();
    expect(safeNext('/start?next=%2F')).toBeNull();
    expect(safeNext('/starter-kit')).toBe('/starter-kit');
  });

  it.each([
    ['a tile wins over next', 'all', '/decks', '/make', '/make'],
    ['a tile wins for decks-only people too', 'deck', null, '/try/course', '/try/course'],
    ['next beats deck → /make', 'deck', '/decks', undefined, '/decks'],
    ['deck plus / → /make', 'deck', '/', undefined, '/make'],
    ['deck with no next → /make', 'deck', null, undefined, '/make'],
    ['an unsafe next → /', 'all', '//evil.example', undefined, '/'],
    ['/start as next → /', 'present', '/start', undefined, '/'],
    ['no next → /', 'study', null, undefined, '/'],
    ['a safe next is followed', 'all', '/schedule', undefined, '/schedule'],
  ] as const)('%s', (_, focus, next, tile, expected) => {
    expect(resolveNext(focus, next, tile)).toBe(expected);
  });

  it('names the page it continues to', () => {
    expect(pageName('/decks')).toBe('Decks');
    expect(pageName('/decks?new=notes')).toBe('Decks');
    expect(pageName('/settings')).toBe('Preferences');
    expect(pageName('/studio/d_1')).toBe('the deck');
    expect(pageName('/somewhere')).toBe('your page');
  });
});

describe('front-page links', () => {
  beforeEach(() => {
    localStorage.clear();
    saveProfile(defaultProfile());
  });

  it('go straight there unless they ask for setup', () => {
    expect(ctaTarget('/decks')).toBe('/decks');
    expect(ctaTarget('/try/talk/present', 'skip')).toBe('/try/talk/present');
  });

  it('send someone who has not set up through /start, keeping the destination', () => {
    expect(ctaTarget('/', 'ask')).toBe('/start?next=%2F');
    expect(ctaTarget('/decks', 'ask')).toBe('/start?next=%2Fdecks');
    expect(ctaTarget('https://example.com', 'ask')).toBe('https://example.com');
  });

  it('go straight there once set up', () => {
    saveProfile({ ...defaultProfile(), onboarded: true });
    expect(ctaTarget('/', 'ask')).toBe('/');
  });

  it('build /try links', () => {
    expect(tryHref('talk')).toBe('/try/talk/studio');
    expect(tryHref('talk', 'present')).toBe('/try/talk/present');
    expect(tryHref('talk', 'present', 3)).toBe('/try/talk/present?from=3');
    expect(tryHref('talk', 'present', 0)).toBe('/try/talk/present');
  });
});

describe('sample decks', () => {
  beforeAll(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('seeds once, however many callers ask', async () => {
    expect(seedOnce()).toBe(seedOnce());
    await seedOnce();
    expect(await db.decks.count()).toBe(buildSeed(new Date()).decks.length);
  });

  it('puts a deleted sample back', async () => {
    await db.decks.delete(SAMPLES.talk);
    expect(await ensureSampleDeck(SAMPLES.talk)).toBe(true);
    const deck = await db.decks.get(SAMPLES.talk);
    expect(deck?.slides.length).toBe(buildSeed(new Date()).decks.find((d) => d.id === SAMPLES.talk)!.slides.length);
  });

  it('never overwrites a sample someone edited', async () => {
    await db.decks.update(SAMPLES.report, { title: 'My own Q3 notes' });
    expect(await ensureSampleDeck(SAMPLES.report)).toBe(true);
    expect((await db.decks.get(SAMPLES.report))?.title).toBe('My own Q3 notes');
  });

  it('says no for a deck that is not a sample', async () => {
    expect(await ensureSampleDeck('deck_nope')).toBe(false);
    expect(await db.decks.get('deck_nope')).toBeUndefined();
  });

  it('gives the sample talk a script on every slide, as its /start tile says', () => {
    const talk = buildSeed(new Date()).decks.find((d) => d.id === SAMPLES.talk)!;
    expect(talk.slides.filter((s) => s.hidden || !s.notes.script.trim())).toEqual([]);
  });

  it('every /try sample exists in the seed', () => {
    const ids = buildSeed(new Date()).decks.map((d) => d.id);
    for (const id of Object.values(SAMPLES)) expect(ids).toContain(id);
  });
});

// ─── Rendering ────────────────────────────────────────────────────────

let root: Root | null = null;
let host: HTMLDivElement;
let at = '';

function Where() {
  const l = useLocation();
  at = l.pathname + l.search;
  return createElement('p', { 'data-where': at }, at);
}

async function render(path: string, page: React.ReactNode, route: string) {
  at = '';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(ToastProvider, null,
        createElement(Routes, null,
          createElement(Route, { path: route, element: page }),
          createElement(Route, { path: '*', element: createElement(Where) })))));
  });
}

/** Waits for the page to move on to another route. */
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  expect(check()).toBe(true);
}

const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;

// jsdom has no ResizeObserver; slide previews only need it to exist.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  saveProfile(defaultProfile());
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe('/try links', () => {
  it('open the sample in its view, keeping the query', async () => {
    await render('/try/talk/present?from=3', createElement(TrySample), 'try/:sample/:view?');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Opening the sample talk');
    await until(() => at !== '');
    expect(at).toBe('/present/deck_meetings_talk?from=3');
    expect(localStorage.getItem('lectern.welcomed')).toBe('1');
  });

  it('open the studio when no view is given', async () => {
    await render('/try/writing', createElement(TrySample), 'try/:sample/:view?');
    await until(() => at !== '');
    expect(at).toBe('/studio/deck_main_thing_first');
  });

  it('open the sample course', async () => {
    await render('/try/course', createElement(TrySample), 'try/:sample/:view?');
    await until(() => at !== '');
    expect(at).toBe('/courses/course_earth');
  });

  const pairs = Object.entries(SAMPLES).flatMap(([s, id]) => VIEWS.map((v) => [s, v, id] as const));
  it.each(pairs)('open %s in %s', async (s, v, id) => {
    await render(`/try/${s}/${v}`, createElement(TrySample), 'try/:sample/:view?');
    await until(() => at !== '');
    expect(at).toBe(`/${v}/${id}`);
  });

  it.each(['/try/nope/present', '/try/talk/edit', '/try/course/present'])('show Nothing here for %s', async (path) => {
    await render(path, createElement(TrySample), 'try/:sample/:view?');
    expect(host.querySelector('h1')?.textContent).toBe('Nothing here');
  });
});

describe('/start', () => {
  const start = (path = '/start') => render(path, createElement(Onboarding), 'start');
  const testIds = () => Array.from(host.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'));

  it('asks one question with five tiles named by their titles', async () => {
    await start();
    expect(host.querySelector('h1')?.textContent).toBe('Where do you want to start?');
    expect(document.activeElement).toBe(host.querySelector('h1'));
    expect(testIds()).toEqual(['start-sample', 'start-notes', 'start-file', 'start-course', 'start-record', 'start-look-around']);
    for (const name of ['Open the sample talk', 'Start from my notes', 'Turn a file into a deck', 'Plan a course', 'Record and review']) {
      expect(Array.from(host.querySelectorAll('.ob-tile strong')).map((s) => s.textContent)).toContain(name);
    }
    const talk = buildSeed(new Date()).decks.find((d) => d.id === SAMPLES.talk)!;
    expect(host.querySelector('[data-testid="start-sample"]')?.textContent).toContain(`A finished ${talk.slides.length}-slide talk`);
    expect(host.querySelector('[role="radio"][data-testid]')).toBeNull();
    expect(host.querySelector('.ob-progress')).toBeNull();
    expect(button('Skip for now')).toBeDefined();
    expect(host.querySelector('a[href="/welcome"]')?.textContent).toContain('Back to the tour');
  });

  it('opens a tile’s page in one click and remembers the choice', async () => {
    await start('/start?next=%2F');
    await act(async () => (host.querySelector('[data-testid="start-sample"]') as HTMLButtonElement).click());
    expect(at).toBe('/try/talk/studio');
    const p = getProfile();
    expect(p.onboarded).toBe(true);
    expect(p.completedAt).toBeGreaterThan(0);
    expect(p.focus).toBe('present');
    expect(p.deck.purpose).toBe('talk');
  });

  it('sends a files-first person to /make', async () => {
    await start();
    await act(async () => (host.querySelector('[data-testid="start-file"]') as HTMLButtonElement).click());
    expect(at).toBe('/make');
    expect(getProfile().focus).toBe('deck');
    expect(getProfile().features).toEqual([]);
  });

  it('lets someone look around, or continue to where they were going', async () => {
    await start('/start?next=%2Fdecks');
    expect(button('Continue to Decks')).toBeDefined();
    await act(async () => (host.querySelector('[data-testid="start-look-around"]') as HTMLButtonElement).click());
    expect(at).toBe('/decks');
    expect(getProfile().focus).toBe('all');
  });

  it.each(['start-look-around', 'Skip for now'])('counts %s as having seen the front page', async (name) => {
    expect(localStorage.getItem('lectern.welcomed')).toBeNull();
    await start();
    const el = (host.querySelector(`[data-testid="${name}"]`) as HTMLButtonElement | null) ?? button(name)!;
    await act(async () => el.click());
    expect(at).toBe('/');
    expect(localStorage.getItem('lectern.welcomed')).toBe('1');
  });

  it('hides Continue when next is Home or unsafe', async () => {
    await start('/start?next=%2F%2Fevil.example');
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.startsWith('Continue to'))).toBe(false);
  });

  it('skips without marking the setup as done', async () => {
    await start('/start?next=%2Fschedule');
    await act(async () => button('Skip for now')!.click());
    expect(at).toBe('/schedule');
    expect(getProfile().onboarded).toBe(true);
    expect(getProfile().completedAt).toBeUndefined();
  });

  it('opens fine-tune with ?tune=1, and saves from it', async () => {
    await start();
    expect((host.querySelector('details.ob-tune') as HTMLDetailsElement).open).toBe(false);
    await act(async () => root?.unmount());
    host.remove();
    await start('/start?tune=1');
    const details = host.querySelector('details.ob-tune') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(details.querySelector('summary')?.textContent).toBe('Fine-tune first (optional)');
    const report = Array.from(details.querySelectorAll('[role="radio"]')).find((b) => b.textContent?.includes('Report')) as HTMLButtonElement;
    await act(async () => report.click());
    await act(async () => button('Save and continue')!.click());
    expect(at).toBe('/');
    expect(getProfile().deck.purpose).toBe('report');
    expect(getProfile().completedAt).toBeGreaterThan(0);
  });
});

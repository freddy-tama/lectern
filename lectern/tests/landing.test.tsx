import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { THEMES } from '../src/core/engine/themes';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { allKinds } from '../src/core/kinds/registry';
import { db } from '../src/data/db';
import Landing, { NAV, PAGE_TITLE } from '../src/features/landing/Landing';
import { SCENES } from '../src/features/landing/PitchFilm';
import { TALK_ID, deckRun, sampleDeck } from '../src/features/landing/samples';

registerCoreKinds();

let root: Root | null = null;
let host: HTMLDivElement;

beforeAll(() => {
  // jsdom draws nothing: slides are sized by ResizeObserver and measured without a canvas.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: ['/welcome'] }, createElement(Landing)));
  });
  // Lets the quiz link finish packing.
  for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 10)));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
});

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...host.querySelectorAll<T>(sel)];
const text = () => host.textContent ?? '';
const byText = (sel: string, label: string) => $$(sel).find((el) => el.textContent?.trim() === label);

describe('the front page', () => {
  it('has one h1, a heading for each section and the page title', () => {
    expect($$('h1')).toHaveLength(1);
    expect($('h1')?.id).toBe('hero-title');
    expect($('h1')?.textContent).toContain('what to say');
    const sections = $$('section[aria-labelledby]').filter((s) => s.querySelector('h2'));
    expect(sections).toHaveLength(10);
    for (const s of sections) expect(document.getElementById(s.getAttribute('aria-labelledby')!)?.tagName).toMatch(/^H[12]$/);
    expect(document.title).toBe(PAGE_TITLE);
    expect($('main#main')?.getAttribute('tabindex')).toBe('-1');
    expect($('a.lp-skip')?.getAttribute('href')).toBe('#main');
  });

  it('links every nav item and proof fact to a section on the page', () => {
    const nav = $$<HTMLAnchorElement>('nav[aria-label="On this page"] a');
    expect(nav.map((a) => a.getAttribute('href'))).toEqual(NAV.map((n) => `#${n.id}`));
    for (const a of [...nav, ...$$<HTMLAnchorElement>('ul[aria-label="At a glance"] a')]) {
      expect(host.querySelector(a.getAttribute('href')!), a.textContent ?? '').not.toBeNull();
    }
    for (const id of ['tour', 'try', 'sample', 'phone-quiz', 'from-notes', 'key-notes', 'uses', 'slide-types', 'looks', 'how-it-works']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  it('computes its counts from the code', () => {
    const kinds = allKinds().filter((k) => !k.plugin).length;
    const facts = $$('ul[aria-label="At a glance"] a').map((a) => a.textContent);
    expect(facts).toContain(`${kinds} slide types`);
    expect(facts).toContain(`${THEMES.length} built-in looks`);
    expect($('#types-title')?.textContent).toContain(`${kinds} slide types`);
    expect(text()).toContain(`Start from ${THEMES.length} built-in looks`);
  });

  it('makes no claim the build cannot back', () => {
    expect(text()).not.toMatch(/Coming soon|no upload|30 layouts|08:12|130 wpm|Fieldkit/);
  });

  it('carries the test ids the first-run checks click', () => {
    for (const id of ['nav-open-lectern', 'hero-present', 'finale-present', 'finale-open-lectern', 'quiz-open-here', 'notes-open-deck']) {
      expect($(`[data-testid="${id}"]`), id).not.toBeNull();
    }
    expect($('[data-testid="hero-present"]')?.getAttribute('href')).toBe('/try/talk/present');
    expect($('[data-testid="nav-open-lectern"]')?.getAttribute('href')).toMatch(/^\/start\?next=%2F$|^\/$/);
    expect($('[data-testid="quiz-open-here"]')?.getAttribute('href')).toMatch(/\/pack#./);
  });

  it('plays the pitch film from the sample talk, and lets you pick a scene and pause', async () => {
    const chapters = $$<HTMLButtonElement>('ol[aria-label="Scenes"] button');
    expect(chapters.map((b) => b.textContent?.replace(/^\d+\s*/, ''))).toEqual(SCENES.map((s) => s.label));
    expect(chapters[0].getAttribute('aria-current')).toBe('step');
    expect($('.pf-caption')?.textContent).toBe(SCENES[0].caption);
    // The words in the film are the sample talk's own.
    const slide = sampleDeck(TALK_ID)!.slides.find((s) => s.id === 's_mt_04')!;
    expect($('.pf-kn-script')?.textContent).toBe(slide.notes.script);
    expect($('.pf-quiz-count')?.textContent).toBe('Question 1 of 3');

    expect($('button[aria-label="Pause the animation"]')).not.toBeNull();
    await act(async () => chapters[2].click());
    expect(chapters[2].getAttribute('aria-current')).toBe('step');
    expect(chapters[0].getAttribute('aria-current')).toBeNull();
    expect($('.pf-caption')?.textContent).toBe(SCENES[2].caption);
    // Picking a scene stops the film on it.
    expect($('button[aria-label="Play the animation"]')).not.toBeNull();
    expect($('.pf')?.getAttribute('data-playing')).toBe('false');
  });

  it('embeds the tour video muted and looping, with controls, a poster and chapters', () => {
    const video = $<HTMLVideoElement>('#tour video')!;
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.controls).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.getAttribute('preload')).toBe('none');
    for (const url of [video.getAttribute('src')!, video.getAttribute('poster')!]) {
      expect(url).toMatch(/^\/media\/lectern-tour\.(mp4|jpg)$/);
      expect(existsSync(`public${url}`), url).toBe(true);
    }
    expect($$('#tour ol button').length).toBeGreaterThan(3);
    expect($('a.hero-watch')?.getAttribute('href')).toBe('#tour');
  });

  it('steps the sample talk the way present mode does', async () => {
    const deck = sampleDeck(TALK_ID)!;
    const { slides, steps } = deckRun(deck);
    const at = slides.findIndex((s) => s.id === 's_mt_04');
    const status = () => $('#sample [role="status"]')?.textContent;
    expect(status()).toBe(`Slide ${at + 1} of ${slides.length} · click 0 of ${steps[at]}`);
    expect($('#sample')?.getAttribute('aria-label')).toBe(`Sample talk: ${deck.title}`);

    const next = $<HTMLButtonElement>('#sample button[aria-label="Next slide"]')!;
    await act(async () => next.click());
    expect(status()).toBe(`Slide ${at + 1} of ${slides.length} · click 1 of ${steps[at]}`);
    await act(async () => next.click());
    expect(status()).toContain(`Slide ${at + 2} of ${slides.length}`);
    expect(byText('#sample a', 'Present')?.getAttribute('href')).toBe(`/try/talk/present?from=${at + 1}`);

    await act(async () => $('#sample')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(status()).toBe(`Slide ${at + 1} of ${slides.length} · click 1 of ${steps[at]}`);

    const answer = byText('#sample button', 'Show answer')!;
    expect(answer.getAttribute('aria-expanded')).toBe('false');
    await act(async () => answer.click());
    expect(answer.getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain(slides[at].notes.check!.answer);

    const audience = byText('#sample button', 'Audience view')!;
    await act(async () => audience.click());
    expect(audience.getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('This is what the room sees.');
  });

  it('turns typed notes into slides and counts them', async () => {
    const box = $<HTMLTextAreaElement>('#notes-input')!;
    const status = () => $('#from-notes [role="status"]')?.textContent ?? '';
    const before = Number(status().split(' ')[0]);
    expect(before).toBeGreaterThan(1);
    expect($$('ul[aria-label="Slides made from your notes"] button')).toHaveLength(before);
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(box, `${box.value}\n\n## Why now\n- a\n- b`);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(Number(status().split(' ')[0])).toBe(before + 1);
    expect(JSON.parse(sessionStorage.getItem('lectern.fromNotes')!).text).toContain('## Why now');

    await act(async () => byText('#from-notes button', 'Clear')!.click());
    expect(text()).toContain('Start with a heading like');
    expect($<HTMLButtonElement>('[data-testid="notes-open-deck"]')!.disabled).toBe(true);
  });

  it('saves one deck from the notes, even after leaving the page and coming back', async () => {
    const save = async () => {
      await act(async () => $<HTMLButtonElement>('[data-testid="notes-open-deck"]')!.click());
      for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 10)));
    };
    // Saving navigates away; coming back mounts the page afresh.
    const comeBack = async () => {
      await act(async () => root!.unmount());
      root = createRoot(host);
      await act(async () => {
        root!.render(createElement(MemoryRouter, { initialEntries: ['/welcome'] }, createElement(Landing)));
      });
    };
    const fromNotes = async () => (await db.decks.toArray()).filter((d) => d.title === 'Why small teams ship faster');
    const before = (await fromNotes()).length;
    await save();
    await comeBack();
    await save();
    expect((await fromNotes()).length).toBe(before + 1);

    // Once the deck is edited elsewhere it is the visitor's, and the notes make a new one.
    const [saved] = await fromNotes();
    await db.decks.update(saved.id, { slides: saved.slides.slice(1) });
    await comeBack();
    await save();
    expect((await fromNotes()).length).toBe(before + 2);
  });

  it('links each key notes tab to its own panel', () => {
    const tabs = $$('[role="tablist"][aria-label="Where key notes go"] [role="tab"]');
    expect(tabs).toHaveLength(5);
    const panels = new Set(tabs.map((t) => t.getAttribute('aria-controls')));
    expect(panels.size).toBe(5);
    for (const id of panels) expect(document.getElementById(id!)?.getAttribute('role')).toBe('tabpanel');
  });
});

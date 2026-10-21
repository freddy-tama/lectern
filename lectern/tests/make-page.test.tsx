import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TOPIC = 'Why small teams ship faster';
const NOTES = `# ${TOPIC}\n\n## Fewer handoffs\n- One owner per change\n- Short reviews\n\n## Faster feedback\n- Ship every day\n- Watch what people do`;

let root: Root | null = null;
let host: HTMLDivElement;
let calls: { url: string; method: string; body: string }[] = [];
let decks: () => Promise<number>;

beforeAll(() => {
  // jsdom draws nothing: slides are sized by ResizeObserver and measured without a canvas.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

/** Opens /make afresh on a server with AI on or off. Every other AI call fails, as with no key. */
async function visit(available: boolean) {
  vi.resetModules();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: String(init?.body ?? '') });
    if (String(url) === '/api/draft-deck' && method === 'GET') return Response.json({ available });
    return Response.json({ error: 'Offline' }, { status: 503 });
  }));
  const { db } = await import('../src/data/db');
  await Promise.all(db.tables.map((t) => t.clear()));
  decks = () => db.decks.count();
  const { registerCoreKinds } = await import('../src/core/kinds/core-kinds');
  registerCoreKinds();
  const { ToastProvider } = await import('../src/ui/Toast');
  const { default: MakePage } = await import('../src/features/autodeck/MakePage');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: ['/make'] }, createElement(ToastProvider, null, createElement(MakePage))));
  });
  await settle();
}

/** Lets reads, the AI status and the deck's save finish. */
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await act(() => new Promise((r) => setTimeout(r, 10)));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...host.querySelectorAll<T>(sel)];
const text = () => host.textContent ?? '';
const byText = (sel: string, label: string) => $$(sel).find((el) => el.textContent?.trim() === label);
const makeButton = () => byText('button', 'Make the deck') as HTMLButtonElement;

async function typeBrief(value: string) {
  const box = $<HTMLTextAreaElement>('.ad-brief textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function addFile(file: File) {
  const input = $<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
}

describe('making a deck with no AI on the server', () => {
  it('says plainly that a topic alone needs AI, and offers notes or a file instead', async () => {
    await visit(false);
    const notice = $('[data-testid="make-no-ai"]');
    expect(notice?.textContent).toContain('AI isn’t set up on this server, so Lectern can’t draft a deck from a topic alone.');
    expect(byText('a', 'Start from notes')?.getAttribute('href')).toBe('/decks?new=notes');
    const picker = vi.spyOn($<HTMLInputElement>('input[type="file"]')!, 'click').mockImplementation(() => {});
    await act(async () => (byText('button', 'Choose a file') as HTMLButtonElement).click());
    expect(picker).toHaveBeenCalledOnce();
    expect(text()).not.toContain('Lectern drafts from that');
    expect(text()).toContain('Without AI, the slides come from your files, not from this note.');
  });

  it('makes no deck from a typed topic, and says why', async () => {
    await visit(false);
    await typeBrief(TOPIC);
    expect(makeButton().disabled).toBe(false);
    await act(async () => makeButton().click());
    await settle();
    expect($('[role="alert"]')?.textContent).toContain('AI isn’t set up here, so Lectern can’t draft from a topic alone. Start from your notes, or add a file.');
    expect(text()).not.toContain('Your deck is ready');
    expect($('#ad-result-title')).toBeNull();
    expect(await decks()).toBe(0);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect($<HTMLTextAreaElement>('.ad-brief textarea')!.value).toBe(TOPIC);
  });

  it('still builds a deck from a Markdown file’s headings', async () => {
    await visit(false);
    await addFile(new File([NOTES], 'small-teams.md', { type: 'text/markdown' }));
    expect(text()).toContain('words');
    expect($('[data-testid="make-no-ai"]')).toBeNull();
    expect(text()).toContain('Lectern builds the slides from your files’ headings and points instead.');
    await act(async () => makeButton().click());
    await settle();
    expect(text()).toContain('Your deck is ready');
    expect($('#ad-result-title')?.textContent).toBe(TOPIC);
    expect($$('.ad-thumb').length).toBeGreaterThan(2);
    expect(await decks()).toBe(1);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
});

describe('making a deck with AI on the server', () => {
  it('sends a topic alone to the AI, as before', async () => {
    await visit(true);
    expect($('[data-testid="make-no-ai"]')).toBeNull();
    expect(text()).toContain('No files? Describe the topic here and Lectern drafts from that.');
    await typeBrief(TOPIC);
    await act(async () => makeButton().click());
    await settle();
    expect(calls.some((c) => c.url === '/api/deck-questions' && c.method === 'POST')).toBe(true);
    const draft = calls.find((c) => c.url === '/api/draft-deck' && c.method === 'POST');
    expect(draft).toBeDefined();
    expect(JSON.parse(draft!.body)).toMatchObject({ topic: TOPIC, mode: 'outline' });
    // The keyless test server refuses, so no deck is made and the reason is shown.
    expect($('[role="alert"]')?.textContent).toContain('Offline');
    expect(await decks()).toBe(0);
  });
});

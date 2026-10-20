// @vitest-environment node
// The check-and-fix loop end to end: the client's fit calls go through the real revise-slide
// handler to a mocked Anthropic SDK, and code (not the model) decides what fits.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Params = { system: string; messages: { content: string }[]; output_config: { effort: string; format: { schema: unknown } } };

const sdk = vi.hoisted(() => ({
  calls: [] as Params[],
  inFlight: 0,
  most: 0,
  reply: (_p: Params): unknown => ({ stop_reason: 'end_turn', content: [] }),
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const Real = (await importOriginal<typeof import('@anthropic-ai/sdk')>()).default;
  class FakeAnthropic extends Real {
    constructor() {
      super({ apiKey: 'test-key' });
      const stream = (params: Params) => ({
        finalMessage: async () => {
          sdk.calls.push(params);
          sdk.most = Math.max(sdk.most, ++sdk.inFlight);
          await new Promise((r) => setTimeout(r, 5));
          sdk.inFlight--;
          return sdk.reply(params);
        },
      });
      Object.defineProperty(this, 'beta', { value: { messages: { stream } } });
    }
  }
  return { default: FakeAnthropic };
});

import { POST, cleanKind, responseSchema } from '../api/revise-slide';
import { fitDeck } from '../src/core/deck/fit';
import { CONT, fitsOnSlide } from '../src/core/deck/split';
import { type Deck, type Slide, deckMinutes, emptyNotes } from '../src/core/deck/types';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { DENSITY } from '../src/core/kinds/kit';
import { getKind } from '../src/core/kinds/registry';
import { fitDraft, fitSummary } from '../src/features/studio/fit-deck';
import { checkRevision, fitSlide, kindSpec } from '../src/features/studio/slide-ai';

registerCoreKinds();

const POINT = 'A point that runs long enough to need two lines on the slide when it is set in the body type';
const longBullets = (n = 14) => Array.from({ length: n }, (_, i) => `${i + 1}. ${POINT}`);

function slideOf(id: string, kind: string, content: Record<string, unknown>): Slide {
  return { id, kind, content, notes: emptyNotes({ script: 'What I say here.', minutes: 2 }) };
}

function deckOf(slides: Slide[], extra: Partial<Deck> = {}): Deck {
  return { id: 'd1', title: 'Deck', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0, slides, ...extra };
}

/** The slide the model was asked about, read back from the prompt. */
function askedAbout(p: Params): { content: Record<string, unknown> } {
  return JSON.parse(/<slide>\n([\s\S]*?)\n<\/slide>/.exec(p.messages[0].content)![1]);
}

const answer = (content: Record<string, unknown>, script = 'What I say here. The detail moved here.') => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({ content, notes: { script, keyPoints: [], cues: [], checkQuestion: '', checkAnswer: '', minutes: 2 } }) }],
});

/** The mocked model: shortens "Fixable", makes "Stubborn" longer still, declines "Declined". */
function model(p: Params) {
  const { content } = askedAbout(p);
  if (content.title === 'Fixable') return answer({ title: 'Fixable', bullets: ['Ship the beta', 'Ask ten users', 'Fix what they hit'], reveal: false });
  if (content.title === 'Declined') return { stop_reason: 'refusal', content: [] };
  return answer({ ...content, bullets: Array.from({ length: 8 }, () => `${POINT} ${POINT} ${POINT}`) });
}

const realFetch = globalThis.fetch;
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/revise-slide') return POST(new Request('http://localhost/api/revise-slide', init));
    throw new Error(`Unexpected request to ${String(url)}`);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env.ANTHROPIC_API_KEY;
});
beforeEach(() => {
  sdk.calls = [];
  sdk.most = 0;
  sdk.reply = model;
});

describe('fit, then re-check, then split', () => {
  const fixable = slideOf('fix', 'bullets', { title: 'Fixable', bullets: longBullets() });
  const stubborn = slideOf('stub', 'bullets', { title: 'Stubborn', bullets: longBullets() });
  const quote = slideOf('quote', 'quote', { quote: POINT.repeat(12), source: '' });
  const fine = slideOf('ok', 'bullets', { title: 'Plan', bullets: ['Ship', 'Learn'] });

  it('keeps an AI fit only when code finds it fits, and splits what still overflows', async () => {
    const deck = deckOf([fine, fixable, stubborn, quote]);
    const { deck: next, report, before } = await fitDraft(deck);
    expect(before).toBe(deck);
    expect(report).toEqual({ found: 3, fitted: 1, split: 1, left: 1, retimed: false, stopped: false });
    expect(sdk.calls).toHaveLength(3);

    const fitted = next.slides.find((s) => s.id === 'fix')!;
    expect(fitted.kind).toBe('bullets');
    expect(fitted.content.bullets).toEqual(['Ship the beta', 'Ask ten users', 'Fix what they hit']);
    expect(fitted.notes.script).toContain('The detail moved here.');
    expect(fitsOnSlide(fitted, deck)).toBe(true);

    // The model's answer for "Stubborn" didn't fit, so the deterministic split took over.
    const parts = next.slides.filter((s) => s.id === 'stub' || s.content.title === `Stubborn ${CONT}`);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.every((s) => fitsOnSlide(s, deck))).toBe(true);
    expect(parts.flatMap((s) => s.content.bullets as string[])).toEqual(stubborn.content.bullets);

    // A quote can't be split; it stays as it was and is counted as left.
    expect(next.slides.find((s) => s.id === 'quote')).toEqual(quote);
    expect(next.slides[0]).toBe(fine);
    expect(fitSummary(report)).toBe('Shortened 1 slide to fit and split 1. 1 slide still doesn’t fit.');
  });

  it('asks in fit mode with the exact warnings and the budget from the layout rules', async () => {
    await fitDraft(deckOf([fixable]));
    const [call] = sdk.calls;
    const user = call.messages[0].content;
    expect(user).toContain('- This list is too long for one slide. Split it or shorten the points.');
    expect(user).toContain(`For this audience a slide holds at most ${DENSITY.adult.bullets} points and about ${DENSITY.adult.words} words. This slide has`);
    expect(user).toContain('Change only what is needed to make the slide fit, and keep its meaning, facts and language.');
    expect(call.system).toContain(`At most ${DENSITY.adult.bullets} points on a slide and about ${DENSITY.adult.words} words.`);
    expect(call.output_config.effort).toBe('low');
    const spec = cleanKind(JSON.parse(JSON.stringify(kindSpec(getKind('bullets')!))))!;
    expect(call.output_config.format.schema).toEqual(responseSchema(spec, 'revise'));
  });

  it('sends at most eight slides to the AI, three at a time, and splits the rest', async () => {
    const many = Array.from({ length: 10 }, (_, i) => slideOf(`s${i}`, 'bullets', { title: 'Stubborn', bullets: longBullets() }));
    const { deck: next, report } = await fitDraft(deckOf(many));
    expect(sdk.calls).toHaveLength(8);
    expect(sdk.most).toBe(3);
    expect(report).toMatchObject({ found: 10, fitted: 0, split: 10, left: 0 });
    expect(next.slides.every((s) => fitsOnSlide(s, deckOf([])))).toBe(true);
  });

  it('falls back to splitting when the AI call fails', async () => {
    const declined = slideOf('dec', 'bullets', { title: 'Declined', bullets: longBullets() });
    const { report } = await fitDraft(deckOf([declined]));
    expect(sdk.calls).toHaveLength(1);
    expect(report).toMatchObject({ fitted: 0, split: 1, left: 0 });
  });

  it('rescales the minutes in code when they are well off the session length', async () => {
    const { deck: next, report } = await fitDraft(deckOf([fine, fixable], { minutes: 20 }));
    expect(report.retimed).toBe(true);
    expect(deckMinutes(next)).toBe(20);
    expect(fitSummary(report, 20)).toBe('Shortened 1 slide to fit. Timed to 20 min.');
  });

  it('changes nothing when every slide fits', async () => {
    const deck = deckOf([fine], { minutes: 2 });
    const { deck: next, report } = await fitDraft(deck);
    expect(next).toBe(deck);
    expect(sdk.calls).toHaveLength(0);
    expect(fitSummary(report)).toBe('');
  });

  it('stops when asked, keeping the slides as they were', async () => {
    const ac = new AbortController();
    ac.abort();
    const deck = deckOf([fixable, stubborn], { minutes: 30 });
    const { deck: next, report } = await fitDeck(deck, { signal: ac.signal, fit: (s, problems) => fitSlide(deck, s, problems, ac.signal) });
    expect(next).toBe(deck);
    expect(report).toMatchObject({ found: 2, fitted: 0, split: 0, left: 2, retimed: false, stopped: true });
    expect(sdk.calls).toHaveLength(0);
  });
});

describe('checking a suggestion before it is shown', () => {
  const deck = deckOf([]);

  it('shows a suggestion that fits as it is, without another call', async () => {
    const slide = slideOf('a', 'bullets', { title: 'Plan', bullets: ['Ship', 'Learn'] });
    const checked = await checkRevision(deck, { kind: 'one', slide });
    expect(checked).toEqual({ result: { kind: 'one', slide }, fitted: false, overflow: false });
    expect(sdk.calls).toHaveLength(0);
  });

  it('fits an overflowing suggestion once, and keeps the fit only if it fits', async () => {
    const fitting = vi.fn();
    const ok = await checkRevision(deck, { kind: 'one', slide: slideOf('a', 'bullets', { title: 'Fixable', bullets: longBullets() }) }, { onFitting: fitting });
    expect(fitting).toHaveBeenCalledTimes(1);
    expect(sdk.calls).toHaveLength(1);
    expect(ok).toMatchObject({ fitted: true, overflow: false });
    expect(ok.result.kind === 'one' && ok.result.slide.content.bullets).toEqual(['Ship the beta', 'Ask ten users', 'Fix what they hit']);

    const stubborn = slideOf('b', 'bullets', { title: 'Stubborn', bullets: longBullets() });
    const still = await checkRevision(deck, { kind: 'one', slide: stubborn });
    expect(still).toEqual({ result: { kind: 'one', slide: stubborn }, fitted: false, overflow: true });
  });

  it('checks both halves of an AI split', async () => {
    const half = slideOf('h1', 'bullets', { title: 'Plan', bullets: ['Ship', 'Learn'] });
    const long = slideOf('h2', 'bullets', { title: 'Fixable', bullets: longBullets() });
    const checked = await checkRevision(deck, { kind: 'two', slides: [half, long] });
    expect(sdk.calls).toHaveLength(1);
    expect(checked.fitted).toBe(true);
    expect(checked.overflow).toBe(false);
    expect(checked.result.kind === 'two' && checked.result.slides[0]).toBe(half);
  });
});

describe('ask mode', () => {
  it('reports an answer cut off at max_tokens instead of returning half of it', async () => {
    sdk.reply = () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Half an ans' }] });
    const res = await POST(new Request('http://localhost/api/revise-slide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'ask', selection: 'text', kind: kindSpec(getKind('bullets')!), messages: [{ role: 'user', text: 'Why?' }] }),
    }));
    expect(res.status).toBe(422);
  });
});

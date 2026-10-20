// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Params = { messages: { content: string | { type: string; text?: string }[] }[] };

const sdk = vi.hoisted(() => ({ calls: [] as Params[], reply: (_p: Params): unknown => ({ stop_reason: 'end_turn', content: [] }) }));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const Real = (await importOriginal<typeof import('@anthropic-ai/sdk')>()).default;
  class FakeAnthropic extends Real {
    constructor() {
      super({ apiKey: 'test-key' });
      const stream = (params: Params) => ({ finalMessage: async () => { sdk.calls.push(params); return sdk.reply(params); } });
      Object.defineProperty(this, 'beta', { value: { messages: { stream } } });
    }
  }
  return { default: FakeAnthropic };
});

import { POST as askQuestions } from '../api/deck-questions';
import { POST as draftDeck, audienceRule, cleanDraftContent } from '../api/draft-deck';
import { DENSITY } from '../src/core/kinds/kit';

const kinds = [
  { kind: 'bullets', label: 'Bullets', description: 'Points', fields: [{ key: 'title', type: 'textarea' }, { key: 'bullets', type: 'list' }, { key: 'reveal', type: 'toggle' }, { key: 'image', type: 'image' }] },
  { kind: 'question', label: 'Question', description: 'A question', fields: [{ key: 'question', type: 'textarea' }, { key: 'options', type: 'list' }, { key: 'answer', type: 'textarea' }] },
  { kind: 'gallery', label: 'Gallery', description: 'Pictures', fields: [{ key: 'title', type: 'text' }, { key: 'images', type: 'objects', fields: ['image', 'caption'] }] },
];

const notes = { script: 'Say this.', keyPoints: [], cues: [], checkQuestion: '', checkAnswer: '', minutes: 2 };
const reply = (value: unknown) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }] });
const request = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  sdk.calls = [];
});
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

describe('drafted slide content', () => {
  it('keeps only the fields each kind defines, with the right types and sizes', () => {
    const bullets = cleanDraftContent(kinds[0], { title: '  Plan  ', bullets: ['a', '', 'x'.repeat(900), 3], reveal: 'yes', image: 'pic2', script: 'stray' }, ['pic1', 'pic2']);
    expect(bullets).toEqual({ title: 'Plan', bullets: ['a', 'x'.repeat(600)], image: 'pic2' });
    expect(cleanDraftContent(kinds[0], { image: 'pic9', reveal: true }, ['pic1'])).toEqual({ reveal: true });
    expect(cleanDraftContent(kinds[1], { question: 'Q?', options: ['a', 'b'], correct: 1 }, [])).toEqual({ question: 'Q?', options: ['a', 'b'], correct: 1 });
    expect(cleanDraftContent(kinds[1], { question: 'Q?', options: ['a'], correct: 4 }, []).correct).toBe(-1);
    expect(cleanDraftContent(kinds[2], { title: 'T', images: [{ image: 'pic1', caption: 'c', extra: 'x' }, 'bad'] }, ['pic1'])).toEqual({ title: 'T', images: [{ image: 'pic1', caption: 'c' }] });
    expect(cleanDraftContent(kinds[0], null, [])).toEqual({});
  });

  it('writes the audience budget from the request into the prompt', () => {
    expect(audienceRule('young', DENSITY.young)).toBe(`Young learners aged 6-11. At most ${DENSITY.young.bullets} points per slide and about ${DENSITY.young.words} words on a slide. Simple words, concrete examples, frequent quick checks. Scripts are short and warm.`);
    expect(audienceRule('adult', null)).not.toMatch(/\d+ words/);
  });

  it('cleans every drafted slide and drops kinds it was not offered', async () => {
    sdk.reply = () => reply({ title: 'Deck', slides: [
      { kind: 'bullets', content: { title: 'Plan', bullets: ['Ship'], reveal: false, injected: 'stray field' }, notes },
      { kind: 'unknown', content: {}, notes },
    ] });
    const res = await draftDeck(request('http://x/api/draft-deck', { topic: 'Shipping', audience: 'adult', kinds, budget: DENSITY.adult }));
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft.slides).toHaveLength(1);
    expect(draft.slides[0].content).toEqual({ title: 'Plan', bullets: ['Ship'], reveal: false });
    const prompt = sdk.calls[0].messages[0].content as { type: string; text?: string }[];
    expect(prompt[0].text).toContain(`At most ${DENSITY.adult.bullets} points per slide and about ${DENSITY.adult.words} words on a slide.`);
  });
});

describe('deck questions', () => {
  it('reports questions cut off at max_tokens instead of failing to read them', async () => {
    sdk.reply = () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"title":"De' }] });
    const res = await askQuestions(request('http://x/api/deck-questions', { brief: 'A talk about shipping' }));
    expect(res.status).toBe(422);
  });
});

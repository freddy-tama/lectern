// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { DENSITY } from '../src/core/kinds/kit';
import { kindCatalogue } from '../src/features/studio/ai';

// A stand-in for the Anthropic SDK: records each request and answers with what the test sets.
const sdk = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  reply: (() => { throw new Error('no reply set'); }) as (params: Record<string, unknown>) => unknown,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status?: number }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static RateLimitError = RateLimitError;
    static BadRequestError = BadRequestError;
    beta = {
      messages: {
        stream: (params: Record<string, unknown>) => {
          sdk.calls.push(params);
          return { finalMessage: async () => sdk.reply(params) };
        },
      },
    };
  }
  return { default: Anthropic };
});

const {
  POST, OUTLINE_TASK, audienceRule, checkBatch, cleanCatalogue, cleanNumbers, cleanOutline, pictureRoom, readInput, slidesTask, stagedRequest, stagedSchema, usageOf,
} = await import('../api/draft-deck');
const { POST: askQuestions } = await import('../api/deck-questions');

registerCoreKinds();

/** The catalogue as the server sees it: built from the registry, then cleaned like a request body. */
const kinds = cleanCatalogue(JSON.parse(JSON.stringify(kindCatalogue())));
const kind = (k: string) => kinds.find((x) => x.kind === k)!;
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const pictures = [1, 2, 3].map((n) => ({ id: `pic${n}`, name: `photo${n}.png`, mime: 'image/png', data: PIXEL }));

const body = (extra: Record<string, unknown> = {}) => ({
  topic: 'How volcanoes form',
  audience: 'teen',
  purpose: 'lesson',
  minutes: 30,
  density: 'balanced',
  material: 'Magma rises through cracks in the crust.',
  answers: [{ question: 'Level?', answer: 'Year 9' }],
  pictures,
  kinds: kindCatalogue(),
  hints: '',
  ...extra,
});

const post = (data: unknown, headers: Record<string, string> = {}) => POST(new Request('http://localhost/api/draft-deck', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(data),
}));

const message = (answer: unknown, o: { stop?: string; usage?: Record<string, unknown> } = {}) => ({
  model: 'claude-opus-5-5',
  stop_reason: o.stop ?? 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }],
  usage: { input_tokens: 40, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 6000, iterations: null, ...o.usage },
});

const outline = [
  { title: 'Volcanoes', kind: 'title', minutes: 1, point: 'What we cover', pictures: ['pic1'] },
  { title: 'Inside the Earth', kind: 'bullets', minutes: 4, point: 'Layers and heat', pictures: [] },
  { title: 'Magma rises', kind: 'image', minutes: 3, point: 'Pressure pushes it up', pictures: ['pic2'] },
  { title: 'Check', kind: 'question', minutes: 2, point: 'What makes magma rise?', pictures: [] },
  { title: 'Takeaways', kind: 'summary', minutes: 2, point: 'Three things to keep', pictures: [] },
];

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.LECTERN_ACCESS_CODE;
  sdk.calls.length = 0;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('catalogue and schemas', () => {
  it('knows which slide types hold pictures, and how many', () => {
    expect(kind('gallery').fields.find((f) => f.key === 'images')).toMatchObject({ type: 'objects', images: ['image'], max: 4 });
    expect(pictureRoom(kind('bullets'))).toBe(1);
    expect(pictureRoom(kind('gallery'))).toBe(4);
    expect(pictureRoom(kind('people'))).toBe(6);
    expect(pictureRoom(kind('quote'))).toBe(0);
  });

  it('uses one schema for outline and slides: an outline of known kinds, and numbered slides', () => {
    const input = readInput(body());
    if (typeof input === 'string') throw new Error(input);
    const schema = stagedSchema(kinds, input.pictures) as Record<string, any>;
    expect(schema.required).toEqual(['title', 'outline', 'slides']);
    const item = schema.properties.outline.items;
    expect(item.required).toEqual(['title', 'kind', 'minutes', 'point', 'pictures']);
    expect(item.properties.kind.enum).toContain('bullets');
    expect(item.properties.pictures.items.enum).toEqual(['pic1', 'pic2', 'pic3']);
    const variants = schema.properties.slides.items.anyOf as Record<string, any>[];
    expect(variants).toHaveLength(kinds.length);
    expect(variants[0].required).toEqual(['number', 'kind', 'content', 'notes']);
    // Without pictures there is nothing to assign.
    const plain = stagedSchema(kinds, []) as Record<string, any>;
    expect(plain.properties.outline.items.required).not.toContain('pictures');
    expect(plain.properties.outline.items.properties.pictures).toBeUndefined();
  });

  it('lets picture sub-fields take only a picture id, and leaves them out without pictures', () => {
    const galleryOf = (s: Record<string, any>) => (s.properties.slides.items.anyOf as Record<string, any>[]).find((v) => v.properties.kind.enum[0] === 'gallery')!.properties.content.properties.images.items;
    const input = readInput(body());
    if (typeof input === 'string') throw new Error(input);
    expect(galleryOf(stagedSchema(kinds, input.pictures)).properties.image.enum).toEqual(['', 'pic1', 'pic2', 'pic3']);
    const bare = galleryOf(stagedSchema(kinds, []));
    expect(Object.keys(bare.properties)).toEqual(['caption']);
    expect(bare.required).toEqual(['caption']);
  });
});

describe('the cached prefix', () => {
  it('marks the end of the shared part, so outline and slides calls share everything before the task', () => {
    const input = readInput(body());
    if (typeof input === 'string') throw new Error(input);
    const a = stagedRequest(input, OUTLINE_TASK);
    const b = stagedRequest(input, slidesTask('Volcanoes', outline, [2, 3]));
    // brief, then a label and an image per picture, then the task
    expect(a.content).toHaveLength(1 + pictures.length * 2 + 1);
    const marked = a.content.flatMap((block, i) => ('cache_control' in block && block.cache_control ? [i] : []));
    expect(marked).toEqual([a.content.length - 2]);
    expect(a.content[a.content.length - 2]).toMatchObject({ type: 'image', cache_control: { type: 'ephemeral' } });
    expect(JSON.stringify(a.content.slice(0, -1))).toBe(JSON.stringify(b.content.slice(0, -1)));
    expect(a.system).toBe(b.system);
    expect(JSON.stringify(a.schema)).toBe(JSON.stringify(b.schema));
    expect(a.content.at(-1)).toEqual({ type: 'text', text: OUTLINE_TASK });
    expect(b.content.at(-1)).not.toEqual(a.content.at(-1));
  });

  it('marks the brief itself when there are no pictures', () => {
    const input = readInput(body({ pictures: [] }));
    if (typeof input === 'string') throw new Error(input);
    const r = stagedRequest(input, OUTLINE_TASK);
    expect(r.content).toHaveLength(2);
    expect(r.content[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    expect(r.system).toContain('Task OUTLINE');
    expect(r.system).not.toContain('"pictures"');
  });

  it('lists the whole outline in a slides task and marks the slides to write', () => {
    const task = slidesTask('Volcanoes', outline, [2, 3]);
    expect(task).toContain('Task: SLIDES 2 and 3.');
    expect(task).toContain('→ 2. [bullets] Inside the Earth · 4 min · Layers and heat');
    expect(task).toContain('  1. [title] Volcanoes · 1 min · What we cover · pictures: pic1');
    expect(slidesTask('', outline, [1, 2, 3])).toContain('Write slides 1 to 3 only.');
  });

  it('sends the same prefix bytes on the outline call and on a batch call', async () => {
    sdk.reply = () => message({ title: 'Volcanoes', outline, slides: [] });
    await post({ ...body(), mode: 'outline' });
    sdk.reply = () => message({ title: '', outline: [], slides: [] });
    await post({ ...body(), mode: 'slides', outline: { title: 'Volcanoes', slides: outline }, numbers: [4, 5] });
    const [first, second] = sdk.calls as { system: string; messages: { content: unknown[] }[]; output_config: unknown; thinking: unknown; model: string }[];
    expect(second!.system).toBe(first!.system);
    expect(JSON.stringify(second!.output_config)).toBe(JSON.stringify(first!.output_config));
    expect(second!.thinking).toEqual(first!.thinking);
    expect(second!.model).toBe(first!.model);
    expect(JSON.stringify(second!.messages[0]!.content.slice(0, -1))).toBe(JSON.stringify(first!.messages[0]!.content.slice(0, -1)));
  });
});

describe('cleaning the outline', () => {
  it('keeps known kinds, sensible minutes, and each picture on one slide that has room for it', () => {
    const cleaned = cleanOutline([
      { title: '  Opening  ', kind: 'title', minutes: 0.1, point: 'Hello', pictures: ['pic1', 'pic1', 'pic2'] },
      { title: 'Made up', kind: 'hologram', minutes: 3, point: '' },
      { title: 'Quote', kind: 'quote', minutes: 99, point: 'Words', pictures: ['pic3'] },
      { title: 'Gallery', kind: 'gallery', minutes: 2, point: 'Look', pictures: ['pic1', 'pic2', 'pic9', 'pic3'] },
    ], kinds, ['pic1', 'pic2', 'pic3']);
    expect(cleaned).toEqual([
      { title: 'Opening', kind: 'title', minutes: 0.5, point: 'Hello', pictures: ['pic1'] },
      { title: 'Quote', kind: 'quote', minutes: 30, point: 'Words', pictures: [] },
      { title: 'Gallery', kind: 'gallery', minutes: 2, point: 'Look', pictures: ['pic2', 'pic3'] },
    ]);
  });

  it('reads slide numbers within the outline, once each, at most eight', () => {
    expect(cleanNumbers([3, '2', 2, 0, 9, 1.5, 'x'], 5)).toEqual([2, 3]);
    expect(cleanNumbers(Array.from({ length: 12 }, (_, i) => i + 1), 20)).toHaveLength(8);
    expect(cleanNumbers('1,2', 5)).toEqual([]);
  });
});

describe('checking a batch', () => {
  const plan = cleanOutline(outline, kinds, ['pic1', 'pic2', 'pic3']);
  const notes = { script: 'Say this.', keyPoints: ['One'], cues: [], checkQuestion: '', checkAnswer: '', minutes: 3 };

  it('keeps only the slides asked for, once each, with the outline’s kind and pictures', () => {
    const { slides, missing, dropped } = checkBatch([
      { number: 3, kind: 'image', content: { title: 'Magma rises', body: 'Up it goes', image: 'pic3', caption: 'pic2', whole: false, extra: 'x' }, notes },
      { number: 2, kind: 'statement', content: { statement: 'Wrong kind' }, notes },
      { number: 3, kind: 'image', content: { title: 'Again' }, notes },
      { number: 5, kind: 'summary', content: { title: 'Not asked for' }, notes },
    ], [2, 3], plan, kinds);
    expect(slides.map((s) => s.number)).toEqual([3]);
    expect(missing).toEqual([2]);
    expect(dropped).toBe(3);
    // pic3 belongs to no slide; pic2 is this slide's own picture, wherever it was put.
    expect(slides[0]!.content).toEqual({ title: 'Magma rises', body: 'Up it goes', image: '', caption: 'pic2', whole: false });
    expect(slides[0]!.notes).toMatchObject({ script: 'Say this.', keyPoints: ['One'], check: null, minutes: 3, links: [] });
  });

  it('clears pictures inside lists of pictures too', () => {
    const gallery = cleanOutline([{ title: 'G', kind: 'gallery', minutes: 2, point: '', pictures: ['pic1'] }], kinds, ['pic1', 'pic2']);
    const { slides } = checkBatch([{ number: 1, kind: 'gallery', content: { title: 'G', images: [{ image: 'pic1', caption: 'A' }, { image: 'pic2', caption: 'B' }] }, notes }], [1], gallery, kinds);
    expect(slides[0]!.content.images).toEqual([{ image: 'pic1', caption: 'A' }, { image: '', caption: 'B' }]);
  });
});

describe('usage', () => {
  it('reads the top-level figures, or each attempt when a fallback ran', () => {
    expect(usageOf(message({}, { usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } }) as never)).toEqual([
      { model: 'claude-opus-5-5', input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
    ]);
    const fallback = message({}, { usage: { iterations: [
      { type: 'message', model: 'claude-opus-5-5', input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 6, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ] } });
    expect(usageOf(fallback as never).map((u) => [u.model, u.output])).toEqual([['claude-opus-5-5', 1], ['claude-opus-5', 700]]);
  });
});

describe('POST', () => {
  it('returns a cleaned outline with the call’s usage', async () => {
    sdk.reply = () => message({ title: 'Volcanoes', outline: [...outline, { title: 'Bad', kind: 'nope', minutes: 1, point: '' }], slides: [] });
    const res = await post({ ...body(), mode: 'outline' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe('Volcanoes');
    expect(data.outline).toHaveLength(5);
    expect(data.usage).toEqual([{ model: 'claude-opus-5-5', input: 40, output: 900, cacheRead: 0, cacheWrite: 6000 }]);
    const params = sdk.calls[0] as { messages: { content: { text?: string }[] }[]; fallbacks: string; betas: string[] };
    expect(params.messages[0]!.content.at(-1)!.text).toBe(OUTLINE_TASK);
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
  });

  it('writes a batch and reports the slides that didn’t come back', async () => {
    sdk.reply = () => message({ title: '', outline: [], slides: [
      { number: 4, kind: 'question', content: { title: 'What makes magma rise?', options: ['Heat', 'Ice'], correct: 0, answer: 'Heat' }, notes: {} },
      { number: 1, kind: 'title', content: { title: 'Not this one' }, notes: {} },
    ] }, { usage: { cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 } });
    const res = await post({ ...body(), mode: 'slides', outline: { title: 'Volcanoes', slides: outline }, numbers: [4, 5] });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.slides.map((s: { number: number }) => s.number)).toEqual([4]);
    expect(data.slides[0].content.correct).toBe(0);
    expect(data.missing).toEqual([5]);
    expect(data.usage[0].cacheRead).toBe(6000);
  });

  it('refuses a slides call without an outline or numbers', async () => {
    expect((await post({ ...body(), mode: 'slides', numbers: [1] })).status).toBe(400);
    expect((await post({ ...body(), mode: 'slides', outline: { slides: outline }, numbers: [] })).status).toBe(400);
    expect(sdk.calls).toHaveLength(0);
  });

  it('says why a call stopped, with the tokens it used', async () => {
    sdk.reply = () => message({}, { stop: 'refusal' });
    let res = await post({ ...body(), mode: 'slides', outline: { slides: outline }, numbers: [1] });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'refused', usage: [{ output: 900 }] });
    sdk.reply = () => message({}, { stop: 'max_tokens' });
    res = await post({ ...body(), mode: 'slides', outline: { slides: outline }, numbers: [1, 2] });
    expect(await res.json()).toMatchObject({ code: 'too_long' });
  });

  it('asks for the access code when the server has one', async () => {
    process.env.LECTERN_ACCESS_CODE = 'sesame';
    const res = await post({ ...body(), mode: 'outline' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'needs_code' });
    expect(sdk.calls).toHaveLength(0);
  });

  it('still drafts a whole deck in one call, without a cache mark', async () => {
    sdk.reply = () => message({ title: 'Volcanoes', slides: [
      { kind: 'bullets', content: { title: 'Layers', bullets: ['Crust', 'Mantle'], reveal: false, image: 'pic2' }, notes: { script: 'Hi', keyPoints: [], cues: [], checkQuestion: '', checkAnswer: '', minutes: 2 } },
      { kind: 'hologram', content: {}, notes: {} },
    ] });
    const res = await post(body());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.draft.slides).toHaveLength(1);
    expect(data.draft.slides[0].content.image).toBe('pic2');
    expect(data.usage).toHaveLength(1);
    const params = sdk.calls[0] as { messages: { content: Record<string, unknown>[] }[]; system: string };
    expect(params.messages[0]!.content.some((b) => 'cache_control' in b)).toBe(false);
    expect(params.system).not.toContain('Task OUTLINE');
  });
});

describe('the audience budget', () => {
  it('writes the budget sent with the request into the brief', () => {
    expect(audienceRule('young', DENSITY.young)).toContain(`At most ${DENSITY.young.bullets} points per slide and about ${DENSITY.young.words} words on a slide.`);
    expect(audienceRule('adult', null)).not.toMatch(/\d+ words/);
    const input = readInput(body({ budget: DENSITY.teen }));
    if (typeof input === 'string') throw new Error(input);
    expect(input.budget).toEqual(DENSITY.teen);
    expect(JSON.stringify(stagedRequest(input, OUTLINE_TASK).content[0])).toContain(`about ${DENSITY.teen.words} words on a slide`);
    const without = readInput(body());
    if (typeof without === 'string') throw new Error(without);
    expect(without.budget).toBeNull();
  });
});

describe('deck questions', () => {
  it('reports questions cut off at max_tokens instead of failing to read them', async () => {
    sdk.reply = () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"title":"De' }] });
    const res = await askQuestions(new Request('http://localhost/api/deck-questions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: 'A talk about shipping' }),
    }));
    expect(res.status).toBe(422);
  });
});

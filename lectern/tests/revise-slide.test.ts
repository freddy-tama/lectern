// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { GET, POST, type KindSpec, cleanContent, cleanKind, cleanNotes, contentSchema, responseSchema } from '../api/revise-slide';
import { type Slide, emptyNotes } from '../src/core/deck/types';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { getKind } from '../src/core/kinds/registry';
import { installPlugin } from '../src/core/plugins/registry';
import { applyRevision, applySplit, contentForAi, kindSpec, mergeContent, requestLabel } from '../src/features/studio/slide-ai';
import chinese from '../plugins/chinese/index';

registerCoreKinds();
installPlugin(chinese);

/** The kind as the server sees it: built from the registry, then cleaned like a request body. */
const specOf = (kind: string): KindSpec => cleanKind(JSON.parse(JSON.stringify(kindSpec(getKind(kind)!))))!;

type Schema = { type?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[]; additionalProperties?: boolean; [k: string]: unknown };

/** Every object in a schema, for checks that must hold everywhere. */
function objects(s: Schema, out: Schema[] = []): Schema[] {
  if (s.type === 'object') out.push(s);
  for (const p of Object.values(s.properties ?? {})) objects(p, out);
  if (s.items) objects(s.items, out);
  return out;
}

describe('kind spec from the registry', () => {
  it('describes core kinds with field types, limits and the correct-answer key', () => {
    const bullets = kindSpec(getKind('bullets')!);
    expect(bullets.kind).toBe('bullets');
    expect(bullets.fields.map((f) => [f.key, f.type])).toEqual([['title', 'textarea'], ['bullets', 'list'], ['reveal', 'toggle'], ['image', 'image']]);
    expect(bullets.fields.find((f) => f.key === 'bullets')).toMatchObject({ max: 8 });
    expect(kindSpec(getKind('question')!).fields.find((f) => f.key === 'options')).toMatchObject({ correctKey: 'correct' });
    const people = kindSpec(getKind('people')!).fields.find((f) => f.key === 'people')!;
    expect(people.fields).toEqual([{ key: 'photo', type: 'image', label: 'Photo' }, { key: 'name', type: 'text', label: 'Name' }, { key: 'role', type: 'text', label: 'Role' }]);
  });

  it('includes kinds registered by mods', () => {
    const word = specOf('chinese.word');
    expect(word.kind).toBe('chinese.word');
    expect(word.fields.map((f) => f.key)).toContain('pinyin');
  });

  it('drops malformed kinds and fields the server should not trust', () => {
    expect(cleanKind({ kind: 'Bad Kind', fields: [] })).toBeNull();
    expect(cleanKind({ kind: 'bullets' })).toBeNull();
    const k = cleanKind({ kind: 'x.y', label: 'X', description: 'd', fields: [
      { key: 'ok', type: 'text' }, { key: '1bad', type: 'text' }, { key: 'weird', type: 'script' },
      { key: 'rows', type: 'objects', fields: ['label', { key: 'pic', type: 'image' }, { key: 'nested', type: 'objects' }] },
    ] })!;
    expect(k.fields.map((f) => f.key)).toEqual(['ok', 'rows']);
    expect(k.fields[1].fields).toEqual([{ key: 'label', type: 'text' }, { key: 'pic', type: 'image', label: '' }]);
  });
});

describe('content schema', () => {
  it('turns fields into JSON schema and leaves pictures out', () => {
    const s = contentSchema(specOf('bullets')) as Schema;
    expect(Object.keys(s.properties!)).toEqual(['title', 'bullets', 'reveal']);
    expect(s.properties!.title.type).toBe('string');
    expect(s.properties!.bullets).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(s.properties!.reveal.type).toBe('boolean');
    expect(s.required).toEqual(['title', 'bullets', 'reveal']);
    expect(s.additionalProperties).toBe(false);
  });

  it('adds the correct-answer index for lists that mark one item', () => {
    const s = contentSchema(specOf('question')) as Schema;
    expect(s.properties!.correct.type).toBe('integer');
    expect(s.required).toContain('correct');
  });

  it('builds objects from their sub-fields, without image sub-fields', () => {
    const s = contentSchema(specOf('people')) as Schema;
    const item = s.properties!.people.items!;
    expect(Object.keys(item.properties!)).toEqual(['name', 'role']);
    expect(item.required).toEqual(['name', 'role']);
    const word = contentSchema(specOf('chinese.word')) as Schema;
    expect(Object.keys(word.properties!)).not.toContain('image');
    expect(word.properties!.words.type).toBe('array');
  });

  it('wraps content and key notes for each mode', () => {
    const k = specOf('summary');
    const revise = responseSchema(k, 'revise') as Schema;
    expect(revise.required).toEqual(['content', 'notes']);
    const notes = responseSchema(k, 'notes') as Schema;
    expect(Object.keys(notes.properties!)).toEqual(['notes']);
    expect(notes.properties!.notes.required).toEqual(['script', 'keyPoints', 'cues', 'checkQuestion', 'checkAnswer', 'minutes']);
    const split = responseSchema(k, 'split') as Schema;
    expect(split.required).toEqual(['first', 'second']);
    expect(split.properties!.second.properties!.content.properties!.points.type).toBe('array');
  });

  it('stays within what structured outputs accept for every kind', () => {
    for (const def of ['title', 'bullets', 'compare', 'stats', 'steps', 'question', 'recall', 'chart', 'table', 'timeline', 'gallery', 'people', 'diagram', 'chinese.word', 'chinese.characters', 'chinese.sentence']) {
      const json = JSON.stringify(responseSchema(specOf(def), 'split'));
      expect(json, def).not.toMatch(/"(minItems|maxItems|minimum|maximum|minLength|maxLength|pattern)"/);
      for (const o of objects(JSON.parse(json))) {
        expect(o.additionalProperties, def).toBe(false);
        expect([...(o.required ?? [])].sort(), def).toEqual(Object.keys(o.properties ?? {}).sort());
      }
    }
  });
});

describe('cleaning what the AI returns', () => {
  it('keeps only defined fields at sensible sizes', () => {
    const k = specOf('question');
    const out = cleanContent(k, { question: '  Why?  ', options: ['a', '', 'b', 'c', 'd', 'e', 'f', 'g'], correct: 9, answer: 'Because', extra: 'drop me' });
    expect(out).toEqual({ question: 'Why?', options: ['a', 'b', 'c', 'd', 'e', 'f'], correct: -1, answer: 'Because' });
    expect(cleanContent(k, { question: 'Q', options: ['a', 'b'], correct: 1 }).correct).toBe(1);
  });

  it('turns the check question into the notes shape', () => {
    expect(cleanNotes({ script: 'Hi', keyPoints: ['a'], cues: [], checkQuestion: 'Q?', checkAnswer: 'A', minutes: 99 }))
      .toEqual({ script: 'Hi', keyPoints: ['a'], cues: [], check: { question: 'Q?', answer: 'A' }, minutes: 30 });
    expect(cleanNotes({}).check).toBeNull();
  });
});

describe('applying a suggestion', () => {
  const people: Slide = {
    id: 'p1', kind: 'people', variant: 'grid',
    content: { title: 'Team', people: [{ photo: 'asset:a', name: 'Ana', role: 'Lead' }, { photo: '', name: 'Bo', role: 'Dev' }], mod: 'kept' },
    notes: emptyNotes({ script: 'Old', links: [{ label: 'Site', url: 'https://example.com' }], extra: { m: { k: 'v' } } }),
  };

  it('sends content without pictures', () => {
    const sent = contentForAi(getKind('people')!, people.content);
    expect(sent.people).toEqual([{ name: 'Ana', role: 'Lead' }, { name: 'Bo', role: 'Dev' }]);
    const bullets = contentForAi(getKind('bullets')!, { title: 'T', bullets: [], image: 'data:image/png;base64,xyz' });
    expect(bullets).not.toHaveProperty('image');
  });

  it('keeps id, kind, pictures, unknown fields, links and mod notes', () => {
    const next = applyRevision(people, {
      content: { title: 'Our team', people: [{ name: 'Ana', role: 'Team lead' }, { name: 'Bo', role: 'Engineer' }, { name: 'Cy', role: 'New' }] },
      notes: { script: 'New script', keyPoints: ['k'], cues: [], check: null, minutes: 3 },
    });
    expect(next.id).toBe('p1');
    expect(next.kind).toBe('people');
    expect(next.variant).toBe('grid');
    expect(next.content.title).toBe('Our team');
    expect(next.content.mod).toBe('kept');
    expect(next.content.people).toEqual([
      { name: 'Ana', role: 'Team lead', photo: 'asset:a' },
      { name: 'Bo', role: 'Engineer', photo: '' },
      { name: 'Cy', role: 'New' },
    ]);
    expect(next.notes.script).toBe('New script');
    expect(next.notes.links).toEqual(people.notes.links);
    expect(next.notes.extra).toEqual({ m: { k: 'v' } });
  });

  it('keeps a slide-level picture the AI never sees', () => {
    const merged = mergeContent(getKind('bullets'), { title: 'T', bullets: ['a'], image: 'asset:x' }, { title: 'T2', bullets: ['b'], reveal: false });
    expect(merged).toEqual({ title: 'T2', bullets: ['b'], reveal: false, image: 'asset:x' });
  });

  it('notes-only suggestions leave the slide alone', () => {
    const next = applyRevision(people, { notes: { script: 'Only notes' } });
    expect(next.content).toBe(people.content);
    expect(next.notes.script).toBe('Only notes');
  });

  it('an AI split keeps the first id and starts the second with fresh notes', () => {
    const [a, b] = applySplit(people, [
      { content: { title: 'Team', people: [{ name: 'Ana', role: 'Lead' }] }, notes: { script: 'One' } },
      { content: { title: 'Team (cont.)', people: [{ name: 'Bo', role: 'Dev' }] }, notes: { script: 'Two' } },
    ]);
    expect(a.id).toBe('p1');
    expect(b.id).not.toBe('p1');
    expect(b.kind).toBe('people');
    expect(b.notes.script).toBe('Two');
    expect(b.notes.links).toEqual([]);
    expect(b.content.title).toBe('Team (cont.)');
  });

  it('names requests for the preview', () => {
    expect(requestLabel('shorter')).toBe('Shorter');
    expect(requestLabel('tone', 'formal')).toBe('Tone: More formal');
    expect(requestLabel('custom', 'x'.repeat(60))).toHaveLength(48);
    expect(requestLabel('split')).toBe('Split with AI');
  });
});

describe('the endpoint without a model call', () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, code: process.env.LECTERN_ACCESS_CODE };
  afterEach(() => {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.code === undefined) delete process.env.LECTERN_ACCESS_CODE; else process.env.LECTERN_ACCESS_CODE = saved.code;
  });
  const post = (body: unknown, headers: Record<string, string> = {}) => POST(new Request('http://x/api/revise-slide', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

  it('reports when AI is not set up', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await (await GET()).json()).toMatchObject({ available: false });
    expect((await post({})).status).toBe(503);
  });

  it('asks for the access code before anything else', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.LECTERN_ACCESS_CODE = 'secret';
    const res = await post({ kind: kindSpec(getKind('bullets')!) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ needsCode: true });
  });

  it('rejects requests it cannot act on', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.LECTERN_ACCESS_CODE;
    expect((await post({ kind: { kind: 'NOT OK', fields: [] } })).status).toBe(400);
    expect((await post({ mode: 'ask', kind: kindSpec(getKind('bullets')!), messages: [{ role: 'user', text: 'Why?' }] })).status).toBe(400);
    expect((await post({ mode: 'ask', selection: 'text', kind: kindSpec(getKind('bullets')!), messages: [] })).status).toBe(400);
    expect((await post({ mode: 'revise', preset: 'custom', instruction: '  ', kind: kindSpec(getKind('bullets')!) })).status).toBe(400);
  });
});

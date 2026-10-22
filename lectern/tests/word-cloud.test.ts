// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { estimateMinutes } from '../src/core/deck/draft';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { THEMES, getTheme } from '../src/core/engine/themes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { LIVE_KINDS, cloudWords, perPerson } from '../src/core/kinds/live-kinds';
import { getKind } from '../src/core/kinds/registry';
import { CLOUD_WORDS, cleanWord, cloudLimit, tallyWords, withLiveWords, wordKey } from '../src/core/share/protocol';
import { kindCatalogue } from '../src/features/studio/ai';

registerCoreKinds();

const AUDIENCES = ['young', 'teen', 'adult'] as const;

const slideOf = (content: Record<string, unknown>): Slide => ({ id: 's-cloud', kind: 'wordcloud', content, notes: emptyNotes() });

function lay(content: Record<string, unknown>, o: { theme?: string; audience?: (typeof AUDIENCES)[number]; mode?: 'edit' | 'show'; target?: 'web' | 'pptx' } = {}) {
  return layoutSlide(slideOf(content), { theme: getTheme(o.theme ?? 'paper'), audience: o.audience ?? 'adult', mode: o.mode ?? 'show', target: o.target });
}

const answers = (pairs: [string, number][]) => pairs.map(([text, count]) => ({ text, count: String(count) }));
const wordsOf = (boxes: Box[]) => boxes.filter((b): b is TextBox => b.type === 'text' && b.id.startsWith('word-'));

function overlaps(a: Box, b: Box) {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
}

const MEETING = answers([
  ['Agenda', 9], ['Short', 7], ['Decisions', 6], ['Clear goal', 5], ['On time', 4], ['Focus', 4], ['Actions', 3], ['Coffee', 3],
  ['No laptops', 3], ['Prepared', 2], ['Listening', 2], ['Fewer people', 2], ['Notes', 2], ['Outcome', 1], ['Energy', 1], ['Humour', 1],
]);

describe('word cloud slide', () => {
  it('is registered as an Engage kind', () => {
    expect(LIVE_KINDS.map((k) => k.kind)).toEqual(['wordcloud']);
    const def = getKind('wordcloud')!;
    expect(def.group).toBe('Engage');
    expect(def.heading(def.create())).toMatch(/great meeting/);
  });

  it('lays out empty and full clouds with no warnings for every audience, look and mode', () => {
    for (const theme of THEMES) for (const audience of AUDIENCES) for (const mode of ['show', 'edit'] as const) {
      for (const content of [getKind('wordcloud')!.create(), { ...getKind('wordcloud')!.create(), answers: MEETING }]) {
        const out = lay(content, { theme: theme.id, audience, mode });
        expect(out.warnings, `${theme.id} ${audience} ${mode}`).toEqual([]);
      }
    }
  });

  it('places every word inside the area, none on top of another', () => {
    for (const audience of AUDIENCES) {
      const out = lay({ prompt: 'One word for meetings', answers: MEETING }, { audience });
      const words = wordsOf(out.boxes);
      expect(words.map((w) => w.text).sort()).toEqual(MEETING.map((a) => a.text).sort());
      const title = out.boxes.find((b) => b.id === 'title')!;
      for (const w of words) {
        expect(w.x).toBeGreaterThanOrEqual(0);
        expect(w.x + w.w).toBeLessThanOrEqual(CANVAS_W);
        expect(w.y + w.h).toBeLessThanOrEqual(CANVAS_H);
        expect(overlaps(w, title), `${w.text} on the title`).toBe(false);
      }
      for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
        expect(overlaps(words[i]!, words[j]!), `${words[i]!.text} × ${words[j]!.text}`).toBe(false);
      }
    }
  });

  it('draws more common words bigger, the most common in the accent colour', () => {
    const words = wordsOf(lay({ answers: MEETING }).boxes);
    const size = (t: string) => words.find((w) => w.text === t)!.style.size;
    expect(size('Agenda')).toBeGreaterThan(size('Focus'));
    expect(size('Focus')).toBeGreaterThan(size('Humour'));
    expect(words.find((w) => w.text === 'Agenda')!.style.color).toBe(getTheme('paper').colors.accent);
  });

  it('lands the same words in the same places every time', () => {
    const a = wordsOf(lay({ answers: MEETING }).boxes).map((w) => [w.text, w.x, w.y, w.style.size]);
    const b = wordsOf(lay({ answers: MEETING }).boxes).map((w) => [w.text, w.x, w.y, w.style.size]);
    expect(a).toEqual(b);
  });

  it('copes with a crowd: many words, long words, one word', () => {
    const many = answers(Array.from({ length: 60 }, (_, i) => [`Answer${i}`, (i % 7) + 1] as [string, number]));
    const out = lay({ answers: many });
    expect(wordsOf(out.boxes).length).toBeGreaterThan(30);
    const one = wordsOf(lay({ answers: answers([['Yes', 1]]) }).boxes);
    expect(one).toHaveLength(1);
    expect(one[0]!.style.size).toBeGreaterThan(120);
    const long = wordsOf(lay({ answers: answers([['Supercalifragilisticexpialidocious', 3], ['Ok', 1]]) }).boxes);
    expect(long.map((w) => w.text)).toContain('Supercalifragilisticexpialidocious');
  });

  it('merges words that differ only in case and reads loose counts', () => {
    expect(cloudWords({ answers: [{ text: 'Focus', count: '2' }, { text: 'focus', count: 'x' }, { text: '  ', count: '9' }, { text: 'Agenda', count: '1' }] }))
      .toEqual([{ text: 'Focus', count: 3 }, { text: 'Agenda', count: 1 }]);
  });

  it('asks for answers when it has none, and says how in PowerPoint', () => {
    const show = lay(getKind('wordcloud')!.create());
    expect((show.boxes.find((b) => b.id === 'cloud-hint') as TextBox).text).toMatch(/Answer on your phone/);
    expect(show.boxes.some((b) => b.id === 'cloud-ph')).toBe(false);
    expect(lay(getKind('wordcloud')!.create(), { mode: 'edit' }).boxes.some((b) => b.id === 'cloud-ph')).toBe(true);
    const pptx = lay(getKind('wordcloud')!.create(), { target: 'pptx' });
    expect((pptx.boxes.find((b) => b.id === 'cloud-hint') as TextBox).text).toMatch(/present from Lectern/);
  });

  it('keeps answers per person between one and five', () => {
    expect(perPerson({})).toBe(3);
    expect(perPerson({ perPerson: '1' })).toBe(1);
    expect(perPerson({ perPerson: '12' })).toBe(5);
    expect(perPerson({ perPerson: '0' })).toBe(1);
    expect(perPerson({ perPerson: 'lots' })).toBe(3);
  });

  it('plans time for the room to answer', () => {
    expect(estimateMinutes({ script: '', check: null }, 'wordcloud')).toBeGreaterThanOrEqual(2);
  });

  it('keeps the answers out of AI drafting', () => {
    const cloud = kindCatalogue().find((k) => k.kind === 'wordcloud')!;
    expect(cloud.fields.map((f) => f.key)).toEqual(['prompt', 'perPerson']);
  });

  it('exports the cloud as text boxes, and the hint when it is empty', async () => {
    const deck: Deck = {
      id: 'd', title: 'Meetings', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0,
      slides: [{ ...slideOf({ prompt: 'One word', answers: MEETING }), id: 'a' }, { ...slideOf({ prompt: 'Another word', answers: [] }), id: 'b' }],
    };
    const { data, warnings } = await exportDeckToPptx(deck, { output: 'nodebuffer' });
    expect(warnings).toEqual([]);
    const zip = await JSZip.loadAsync(data as Uint8Array);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('Clear goal');
    expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain('present from Lectern');
  });
});

describe('word cloud answers', () => {
  it('tidies an answer to one short line', () => {
    expect(cleanWord('  "Clear   goal!" ')).toBe('Clear goal');
    expect(cleanWord('a\nb\tc')).toBe('a b c');
    expect(cleanWord('...')).toBe('');
    expect(cleanWord('x'.repeat(50))).toHaveLength(32);
    expect(cleanWord('C++')).toBe('C++');
  });

  it('treats case and Latin accents as the same word, but not other scripts', () => {
    expect(wordKey('Café')).toBe(wordKey('cafe'));
    expect(wordKey('FOCUS')).toBe(wordKey('focus'));
    expect(wordKey('が')).not.toBe(wordKey('か'));
    expect(wordKey('你好')).toBe('你好');
  });

  it('counts each word once per phone and shows the spelling most people used', () => {
    const result = tallyWords(new Map([
      ['p1', ['Focus', 'focus', 'Coffee']],
      ['p2', ['focus']],
      ['p3', ['focus', 'Agenda']],
      ['p4', []],
    ]));
    expect(result.people).toBe(3);
    expect(result.words).toEqual([{ text: 'focus', count: 3 }, { text: 'Coffee', count: 1 }, { text: 'Agenda', count: 1 }]);
  });

  it('leaves hidden words out and keeps at most the commonest words', () => {
    const hidden = tallyWords(new Map([['p1', ['Rude', 'Nice']], ['p2', ['rude']]]), new Set([wordKey('Rude')]));
    expect(hidden.words).toEqual([{ text: 'Nice', count: 1 }]);
    expect(hidden.people).toBe(2);
    const many = tallyWords(new Map(Array.from({ length: 100 }, (_, i) => [`p${i}`, [`w${i}`]])));
    expect(many.words).toHaveLength(CLOUD_WORDS);
  });

  it('knows which slides take words, and how many', () => {
    expect(cloudLimit(slideOf({ perPerson: '2' }))).toBe(2);
    expect(cloudLimit({ kind: 'question', content: {} })).toBeNull();
    expect(cloudLimit(undefined)).toBeNull();
  });

  it('puts live answers in the slide only when there are some', () => {
    const slide = slideOf({ prompt: 'Q', answers: answers([['Saved', 1]]) });
    expect(withLiveWords(slide, undefined)).toBe(slide);
    expect(withLiveWords(slide, { words: [], people: 0 })).toBe(slide);
    const live = withLiveWords(slide, { words: [{ text: 'Live', count: 4 }], people: 4 });
    expect(live.content.answers).toEqual([{ text: 'Live', count: '4' }]);
    expect(slide.content.answers).toEqual([{ text: 'Saved', count: '1' }]);
    const other = { kind: 'question', content: {} };
    expect(withLiveWords(other, { words: [{ text: 'x', count: 1 }], people: 1 })).toBe(other);
  });
});

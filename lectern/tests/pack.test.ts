import { describe, expect, it } from 'vitest';
import type { Slide } from '../src/core/deck/types';
import { type QuizPack, decodePack, encodePack, fitsQr, isPack, packUrl, quizPackFrom, scorePack } from '../src/core/share/pack';
import { quizHtml, slidesLiteHtml } from '../src/features/share/standalone';

const q = (id: string, question: string, options: string[], correct?: number, answer?: string, hidden?: boolean) =>
  ({ id, kind: 'question', content: { question, options, ...(correct !== undefined ? { correct } : {}), ...(answer ? { answer } : {}) }, ...(hidden ? { hidden } : {}) }) as unknown as Slide;

const pack: QuizPack = {
  v: 1, t: 'quiz', title: 'The Water Cycle',
  items: [
    { q: 'What heats the water?', c: ['The Sun', 'The Moon', 'Wind'], a: 0 },
    { q: 'Why is vapour not salty?', c: ['Salt stays behind', 'Clouds filter it'], a: 0, e: 'Only water evaporates.' },
  ],
};

describe('offline packs', () => {
  it('round-trips through the link, compressed', async () => {
    const encoded = await encodePack(pack);
    expect(encoded[0]).toBe('z');
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodePack(encoded)).toEqual(pack);
    expect(await decodePack(`#${encoded}`)).toEqual(pack);
  });

  it('reads uncompressed links too', async () => {
    const plain = `j${btoa(unescape(encodeURIComponent(JSON.stringify(pack)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    expect(await decodePack(plain)).toEqual(pack);
  });

  it('turns away broken or foreign links', async () => {
    const encoded = await encodePack(pack);
    expect(await decodePack(encoded.slice(0, 20))).toBeNull();
    expect(await decodePack('')).toBeNull();
    expect(await decodePack('xabc')).toBeNull();
    expect(isPack({ v: 1, t: 'quiz', title: 'x', items: [{ q: 'a', c: ['one'], a: 0 }] })).toBe(false);
    expect(isPack({ v: 1, t: 'quiz', title: 'x', items: [{ q: 'a', c: ['one', 'two'], a: 2 }] })).toBe(false);
    expect(isPack({ v: 1, t: 'slides', title: 'x', slides: [{ h: 'Hi', b: ['there'] }] })).toBe(true);
  });

  it('takes the scored questions from a deck, with explanations that add something', () => {
    const p = quizPackFrom('Deck', [
      q('a', 'Two plus two?', ['3', '4'], 1, '4'),
      q('b', 'Open question', ['yes', 'no']),
      q('c', 'Hidden one', ['x', 'y'], 0, undefined, true),
      q('d', 'Capital of France?', ['Paris', 'Rome', ''], 0, 'Paris has been the capital since 987.'),
    ]);
    expect(p.items).toEqual([
      { q: 'Two plus two?', c: ['3', '4'], a: 1 },
      { q: 'Capital of France?', c: ['Paris', 'Rome'], a: 0, e: 'Paris has been the capital since 987.' },
    ]);
  });

  it('scores answers', () => {
    expect(scorePack(pack, [0, 1])).toEqual({ right: 1, of: 2, percent: 50 });
    expect(scorePack(pack, [0, 0])).toEqual({ right: 2, of: 2, percent: 100 });
    expect(scorePack(pack, [])).toEqual({ right: 0, of: 2, percent: 0 });
  });

  it('keeps links short enough for a QR code', async () => {
    const url = packUrl('https://lectern.example/', await encodePack(pack));
    expect(url.startsWith('https://lectern.example/pack#z')).toBe(true);
    expect(fitsQr(url)).toBe(true);
    expect(fitsQr(`https://x/pack#${'a'.repeat(4000)}`)).toBe(false);
  });
});

describe('single-file pages', () => {
  it('embeds the quiz safely', () => {
    const html = quizHtml({ ...pack, title: 'Tags </script><b>' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Tags &lt;/script&gt;&lt;b&gt;</title>');
    // The title appears once as text and once inside the JSON, escaped.
    expect(html.match(/<\/script>/g)?.length).toBe(2);
    expect(html).toContain('\\u003c/script>');
  });

  it('lists every slide in the text-only copy', () => {
    const html = slidesLiteHtml({ v: 1, t: 'slides', title: 'Deck', slides: [{ h: 'One', b: ['a & b'] }, { h: 'Two', b: [] }] });
    expect(html).toContain('<h2>One</h2>');
    expect(html).toContain('<li>a &amp; b</li>');
    expect(html).toContain('2 slides');
  });
});

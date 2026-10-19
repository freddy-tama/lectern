// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS, PartCollector, assetIds, deckForRole, deviceLabel, formatCode, joinUrl, newCode, normalizeCode, pollChoices,
  splitParts, tally, tokenFromHash,
} from '../src/core/share/protocol';
import { buildSeed } from '../src/data/seed';

const seed = buildSeed(new Date('2026-10-19T10:00:00'));
const lessonDeck = seed.decks.find((d) => d.lessonId)!;

describe('what each role receives', () => {
  it('gives the presenter everything but the lesson link', () => {
    const deck = deckForRole(lessonDeck, 'presenter', DEFAULT_OPTIONS);
    expect(deck.slides).toHaveLength(lessonDeck.slides.length);
    expect(deck.slides[0]!.notes.script).toBe(lessonDeck.slides[0]!.notes.script);
    expect(deck.lessonId).toBeUndefined();
    expect(deck.purpose).toBe('lesson');
  });

  it('never gives viewers the script, cues or mod fields', () => {
    const withExtra = { ...lessonDeck, extra: { plan: { goal: 'private' } }, slides: lessonDeck.slides.map((s, i) => (i === 1 ? { ...s, hidden: true } : s)) };
    for (const shareTakeaways of [false, true]) {
      const deck = deckForRole(withExtra, 'audience', { ...DEFAULT_OPTIONS, shareTakeaways });
      expect(deck.extra).toBeUndefined();
      expect(deck.slides).toHaveLength(lessonDeck.slides.length - 1);
      for (const s of deck.slides) {
        expect(s.notes.script).toBe('');
        expect(s.notes.cues).toEqual([]);
        expect(s.notes.extra).toBeUndefined();
      }
      const anyPoints = deck.slides.some((s) => s.notes.keyPoints.length > 0);
      expect(anyPoints).toBe(shareTakeaways);
    }
  });

  it('finds image assets anywhere in a value', () => {
    expect([...assetIds({ a: ['asset:x1', { b: 'asset:y2' }], c: 'https://x/asset:no', d: 'asset:x1' })]).toEqual(['x1', 'y2']);
  });
});

describe('codes and links', () => {
  it('makes readable six-character codes and normalises typing', () => {
    const code = newCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normalizeCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `)).toBe(code);
    expect(normalizeCode('ABC10O')).toBe('');
    expect(normalizeCode('ABCD')).toBe('');
    expect(formatCode('ABC234')).toBe('ABC 234');
  });

  it('keeps the presenter token in the fragment', () => {
    expect(joinUrl('https://lectern.app', 'ABC234')).toBe('https://lectern.app/join/ABC234');
    const url = joinUrl('https://lectern.app', 'ABC234', 'tok3n');
    expect(url).toBe('https://lectern.app/join/ABC234#p=tok3n');
    expect(tokenFromHash(new URL(url).hash)).toBe('tok3n');
    expect(tokenFromHash('')).toBeUndefined();
  });
});

describe('sending a deck in parts', () => {
  it('splits and reassembles in any order', () => {
    const text = JSON.stringify(seed.decks);
    const parts = splitParts(text, 1000);
    expect(parts.length).toBeGreaterThan(5);
    const c = new PartCollector(parts.length);
    const order = parts.map((_, i) => i).reverse();
    order.forEach((i, n) => { expect(c.add(i, parts[i]!)).toBe(n === order.length - 1); });
    c.add(0, 'duplicate');
    expect(c.text()).toBe(text);
    expect(c.progress).toBe(1);
  });

  it('keeps every part under the size limit once sent, whatever the text', () => {
    const encoder = new TextEncoder();
    const text = JSON.stringify({ script: '"Quoted" \ café 水的循环 😀 '.repeat(4000), image: 'data:image/png;base64,' + 'A'.repeat(50_000) });
    const parts = splitParts(text);
    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      expect(encoder.encode(JSON.stringify({ t: 'part', i: 999, data: part })).length).toBeLessThan(16_300);
    }
    // Plain stretches still travel in big parts.
    expect(parts.length).toBeLessThan(40);
  });
});

describe('polls', () => {
  it('reads choices from question slides only', () => {
    expect(pollChoices({ kind: 'question', content: { options: ['A', ' ', 'B'] } })).toEqual(['A', 'B']);
    expect(pollChoices({ kind: 'question', content: { options: ['Only one'] } })).toBeNull();
    expect(pollChoices({ kind: 'bullets', content: { options: ['A', 'B'] } })).toBeNull();
  });

  it('counts one vote per device', () => {
    const votes = new Map([['p1', 0], ['p2', 1], ['p3', 1], ['p4', 7]]);
    expect(tally(votes, 3)).toEqual({ counts: [1, 2, 0], total: 3 });
  });
});

describe('device names', () => {
  it('names common devices', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile')).toBe('Android phone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows PC');
  });
});

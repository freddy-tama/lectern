// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS, PartCollector, accessQuery, assetIds, deckForRole, deviceLabel, formatCode, joinUrl, newCode, normalizeCode, phoneStep, pollChoices,
  splitParts, tally, tokenFromHash,
} from '../src/core/share/protocol';
import { cleanAudio } from '../src/core/deck/types';
import { audioClock, audioMime, audioProblem, isAudioName } from '../src/core/media/audio';
import { normalizeDeck } from '../src/data/deck-file';
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

describe('a sound on a slide', () => {
  const slide = { ...lessonDeck.slides[0]!, audio: { src: 'asset:a_sound', title: 'Paragraph 1' } };
  const deck = { ...lessonDeck, slides: [slide] };

  it('reaches viewers with the slide, and its file travels with the deck', () => {
    const shared = deckForRole(deck, 'audience', DEFAULT_OPTIONS);
    expect(shared.slides[0]!.audio).toEqual(slide.audio);
    expect(assetIds(shared).has('a_sound')).toBe(true);
    expect(deckForRole(deck, 'presenter', DEFAULT_OPTIONS).slides[0]!.audio).toEqual(slide.audio);
  });

  it('stays out of slides that have none', () => {
    expect('audio' in deckForRole(lessonDeck, 'audience', DEFAULT_OPTIONS).slides[0]!).toBe(false);
  });

  it('survives saving and opening a deck file, and bad values are dropped', () => {
    expect(cleanAudio({ src: 'asset:x', title: '  Listen  ' })).toEqual({ src: 'asset:x', title: 'Listen' });
    expect(cleanAudio({ src: 'https://a.example/x.mp3' })).toEqual({ src: 'https://a.example/x.mp3' });
    expect(cleanAudio({ src: 'javascript:alert(1)' })).toBeUndefined();
    expect(cleanAudio({ src: 5 })).toBeUndefined();
    expect(cleanAudio(null)).toBeUndefined();
    const norm = normalizeDeck(JSON.parse(JSON.stringify(deck)))!;
    expect(norm.slides[0]!.audio).toEqual(slide.audio);
  });

  it('says plainly why a sound won’t play', () => {
    expect(audioProblem({ name: 'NotAllowedError' })).toMatch(/Tap play again/);
    expect(audioProblem({ name: 'AbortError' })).toBe('');
    expect(audioProblem({ code: 4 })).toMatch(/can’t play this sound file/);
    expect(audioProblem({ code: 2 })).toMatch(/connection/);
    expect(audioClock(65)).toBe('1:05');
    expect(audioClock(Number.NaN)).toBe('0:00');
    expect(isAudioName('ppt/media/media1.mp3')).toBe(true);
    expect(isAudioName('ppt/media/clip.mp4')).toBe(false);
    expect(audioMime('a.MP3')).toBe('audio/mpeg');
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

  it('keeps what the site needs in the address, so phones in mainland China can open the link', () => {
    expect(accessQuery('?eo_token=abc&eo_time=123&other=1')).toBe('?eo_token=abc&eo_time=123');
    expect(accessQuery('?eo_token=abc')).toBe('');
    expect(accessQuery('')).toBe('');
    const url = joinUrl('https://site.dev', 'ABC234', 'tok3n', '?eo_token=abc&eo_time=123');
    expect(url).toBe('https://site.dev/join/ABC234?eo_token=abc&eo_time=123#p=tok3n');
    expect(tokenFromHash(new URL(url).hash)).toBe('tok3n');
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

describe('what a following phone may draw', () => {
  const place = { index: 2, step: 0, reached: 2 };

  it('draws the live slide at the step the big screen shows', () => {
    expect(phoneStep(2, place)).toBe(0);
    expect(phoneStep(2, { ...place, step: 1 })).toBe(1);
  });

  it('keeps clicks hidden on slides the presenter has not reached, so answers wait for their reveal', () => {
    expect(phoneStep(3, place)).toBe(0);
    expect(phoneStep(5, place)).toBe(0);
  });

  it('draws slides already shown in full, even after the presenter goes back', () => {
    expect(phoneStep(1, place)).toBeUndefined();
    expect(phoneStep(4, { index: 1, step: 0, reached: 4 })).toBeUndefined();
    expect(phoneStep(5, { index: 1, step: 0, reached: 4 })).toBe(0);
  });

  it('draws everything when the phone is not following a live deck', () => {
    expect(phoneStep(5, null)).toBeUndefined();
  });
});

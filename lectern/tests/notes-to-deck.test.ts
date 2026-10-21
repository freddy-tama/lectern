// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { autoVariants, suggestLook } from '../src/core/deck/auto-style';
import { draftToDeck } from '../src/core/deck/draft';
import { MAX_NOTES_SLIDES, notesToDeck, slideAtCaret, styleDeck } from '../src/core/deck/notes-to-deck';
import { outlineToDraft } from '../src/core/deck/outline';
import { SAMPLE_LESSON, SAMPLE_TALK } from '../src/core/deck/outline-examples';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

const talk = (o: Partial<Parameters<typeof notesToDeck>[1]> = {}) => notesToDeck(SAMPLE_TALK, { audience: 'adult', purpose: 'talk', look: 'auto', ...o });
/** What a deck shows, without the ids and times that change on every call. */
const shape = (d: ReturnType<typeof talk>) => ({ title: d.title, themeId: d.themeId, autoStyle: d.autoStyle, slides: d.slides.map((s) => ({ kind: s.kind, variant: s.variant, content: s.content, notes: s.notes })) });

describe('notes to a deck', () => {
  it('makes the sample talk as the New deck dialog always has', () => {
    const deck = talk();
    expect(deck.slides.map((s) => s.kind)).toEqual(['title', 'agenda', 'term', 'term', 'steps', 'bullets', 'question', 'summary']);
    expect(deck.title).toBe('Why small teams ship faster');
    expect(deck.purpose).toBe('talk');
    // The dialog's old path: parse, draft, then auto style.
    const before = draftToDeck(outlineToDraft(SAMPLE_TALK), { audience: 'adult', themeId: 'auto', purpose: 'talk' });
    expect(shape(deck)).toEqual(shape(autoVariants({ ...before, themeId: suggestLook(before), autoStyle: true })));
  });

  it('keeps a chosen look and leaves layouts alone', () => {
    const deck = talk({ look: 'midnight' });
    expect(deck.themeId).toBe('midnight');
    expect(deck.autoStyle).toBeUndefined();
    expect(styleDeck(deck, 'chalk')).toBe(deck);
  });

  it('keeps the same id across calls when given one', () => {
    expect(talk({ id: 'd_fixed' }).id).toBe('d_fixed');
    expect(talk({ id: 'd_fixed' }).id).toBe(talk({ id: 'd_fixed' }).id);
    expect(talk().id).not.toBe(talk().id);
  });

  it('picks the look from what the deck is for', () => {
    expect(talk({ purpose: 'pitch' }).themeId).toBe('midnight');
    expect(talk({ purpose: 'report' }).themeId).toBe('minimal');
    expect(talk({ purpose: 'talk' }).themeId).toBe('paper');
  });

  it('takes a title over the notes and falls back when the notes have none', () => {
    expect(talk({ title: '  Shipping faster ' }).title).toBe('Shipping faster');
    expect(talk({ title: '   ' }).title).toBe('Why small teams ship faster');
    expect(notesToDeck('## Why now\n- a\n- b', { audience: 'adult', purpose: 'talk', look: 'paper', fallbackTitle: 'My talk' }).title).toBe('My talk');
  });

  it(`stops at ${MAX_NOTES_SLIDES} slides unless told otherwise`, () => {
    const long = Array.from({ length: 30 }, (_, i) => `## Point ${i + 1}\n- one\n- two`).join('\n\n');
    const o = { audience: 'adult', purpose: 'talk', look: 'paper' } as const;
    expect(notesToDeck(long, o).slides).toHaveLength(MAX_NOTES_SLIDES);
    expect(notesToDeck(long, { ...o, maxSlides: Infinity }).slides).toHaveLength(31);
  });
});

describe('the slide at the caret', () => {
  /** The caret at the start of the first line that begins with `start`, plus `offset`. */
  const caretAt = (text: string, start: string, offset = 0) => text.split('\n').findIndex((l) => l.startsWith(start)) >= 0
    ? text.indexOf(`\n${start}`) + 1 + offset
    : -1;

  it('follows the headings of the sample notes', () => {
    for (const text of [SAMPLE_TALK, SAMPLE_LESSON]) {
      const deck = notesToDeck(text, { audience: 'adult', purpose: 'talk', look: 'paper' });
      expect(slideAtCaret(text, 0)).toBe(0);
      expect(slideAtCaret(text, text.indexOf('\n') + 2)).toBe(0); // the subtitle line
      for (const line of text.split('\n').filter((l) => l.startsWith('## '))) {
        const heading = line.slice(3);
        const i = slideAtCaret(text, caretAt(text, line));
        const s = deck.slides[i]!;
        // Every slide with a heading shows it, except a question (its Q: line) and key terms (one per term).
        if (s.kind === 'question') expect(heading).toBe('Quick check');
        else if (s.kind === 'term') expect(deck.slides[i - 1]!.kind).not.toBe('term');
        else expect(s.content.title, heading).toBe(heading);
        // Anywhere in that part of the notes is the same slide.
        expect(slideAtCaret(text, caretAt(text, line, line.length))).toBe(i);
      }
    }
  });

  it('counts --- breaks, a missing title, Windows line ends and plain paragraphs', () => {
    expect(slideAtCaret('# T\n## A\n- x\n---\nmore', 16)).toBe(2);
    expect(slideAtCaret('## A\n- x\n## B\n- y', 0)).toBe(1);
    expect(slideAtCaret('## A\n- x\n## B\n- y', 10)).toBe(2);
    const crlf = '# T\r\n## A\r\n- x\r\n## B\r\n- y';
    expect(slideAtCaret(crlf, crlf.indexOf('## B'))).toBe(2);
    const prose = 'Deck title\n\nFirst paragraph here.\n\nSecond paragraph here.';
    expect(notesToDeck(prose, { audience: 'adult', purpose: 'talk', look: 'paper' }).slides).toHaveLength(3);
    expect(slideAtCaret(prose, 3)).toBe(0);
    expect(slideAtCaret(prose, prose.indexOf('First'))).toBe(1);
    expect(slideAtCaret(prose, prose.indexOf('Second') + 3)).toBe(2);
    expect(slideAtCaret('', 0)).toBe(0);
  });
});

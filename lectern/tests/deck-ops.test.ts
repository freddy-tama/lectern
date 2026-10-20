import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { type KindSpec, DraftDeck, cleanDeck, cleanKind } from '../api/deck-assistant';
import type { Deck } from '../src/core/deck/types';
import { db } from '../src/data/db';
import { type DeckOp, applyOp, applyOps, assistantKinds, assistantSnapshot, needsTick, opApplies, opPreview, rewritesSlide } from '../src/features/studio/deck-ops';
import { useDeckEditor } from '../src/features/studio/useDeckEditor';
import { sampleDeck, slide } from './assistant-fixtures';

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Proposals as the server makes them, for this deck. */
function propose(deck: Deck, work: (d: DraftDeck) => void): DeckOp[] {
  const kinds = new Map(wire(assistantKinds()).map(cleanKind).filter((k): k is KindSpec => k !== null).map((k) => [k.kind, k]));
  let n = 0;
  const draft = new DraftDeck(cleanDeck(wire(assistantSnapshot(deck)))!, kinds, () => `s_new${++n}`);
  work(draft);
  return wire(draft.ops()) as DeckOp[];
}

const order = (d: Deck) => d.slides.map((s) => s.id);

/** "Cut it down": a shorter title, less time, a summary, a move and a deletion. */
function cutDown(deck: Deck) {
  return propose(deck, (d) => {
    d.editContent('s_why', JSON.stringify({ title: 'Why cache' }), 'Shorter');
    d.editNotes('s_why', { minutes: 2 }, 'Fit the time');
    d.add('s_inval', 'summary', JSON.stringify({ title: 'Recap', points: ['Cache reads'] }), { minutes: 1 }, 'Recap before the end');
    d.move('s_inval', 's_why', 'Problems first');
    d.delete('s_how', 'Too technical');
  });
}

describe('applying proposals', () => {
  it('applies edits, a new slide, a move and a deletion in one change, keeping pictures', () => {
    const deck = sampleDeck();
    const ops = cutDown(deck);
    expect(ops.map((o) => o.op)).toEqual(['edit', 'move', 'add', 'delete']);
    const after = applyOps(deck, ops);
    expect(order(after)).toEqual(['s_title', 's_why', 's_inval', 's_new1', 's_end']);
    const why = after.slides[1];
    expect(why.content).toMatchObject({ title: 'Why cache', image: 'asset:pic1', bullets: ['Faster pages', 'Lower hosting cost', 'Less load on the database'] });
    expect(why.notes).toMatchObject({ minutes: 2, script: 'Caching makes pages faster.' });
    expect(after.slides[3]).toMatchObject({ id: 's_new1', kind: 'summary', content: { title: 'Recap', points: ['Cache reads'] }, notes: { minutes: 1 } });
    // The deck that came in is untouched: the change is a new deck, ready to be one undo step.
    expect(order(deck)).toEqual(['s_title', 's_why', 's_how', 's_inval', 's_end']);
  });

  it('takes some proposals and leaves others: a new slide finds its place without its neighbour', () => {
    const deck = sampleDeck();
    const ops = propose(deck, (d) => {
      d.add('s_why', 'section', JSON.stringify({ title: 'Part 2' }), { minutes: 0.5 }, '');
      d.add('s_new1', 'bullets', JSON.stringify({ title: 'Detail' }), { minutes: 1 }, '');
    });
    expect(ops[1]).toMatchObject({ op: 'add', after: ['s_new1', 's_why', 's_title'] });
    const onlySecond = applyOp(deck, ops[1]);
    expect(order(onlySecond)).toEqual(['s_title', 's_why', 's_new2', 's_how', 's_inval', 's_end']);
  });

  it('lays an edit over later changes by the presenter, field by field', () => {
    const deck = sampleDeck();
    const [op] = propose(deck, (d) => d.editContent('s_how', JSON.stringify({ title: 'How caching works' }), ''));
    const edited = { ...deck, slides: deck.slides.map((s) => (s.id === 's_how' ? { ...s, content: { ...s.content, bullets: ['Rewritten by hand'] } } : s)) };
    expect(applyOp(edited, op).slides[2].content).toMatchObject({ title: 'How caching works', bullets: ['Rewritten by hand'] });
  });

  it('skips proposals that no longer apply', () => {
    const deck = sampleDeck();
    const [edit] = propose(deck, (d) => d.editNotes('s_how', { minutes: 1 }, ''));
    const without = { ...deck, slides: deck.slides.filter((s) => s.id !== 's_how') };
    expect(opApplies(without, edit)).toBe(false);
    expect(applyOp(without, edit)).toBe(without);
    const [del] = propose(deck, (d) => d.delete('s_end', ''));
    const lonely = { ...deck, slides: deck.slides.filter((s) => s.id === 's_end') };
    expect(applyOp(lonely, del)).toBe(lonely);
  });

  it('previews each proposal before and after', () => {
    const deck = sampleDeck();
    const ops = cutDown(deck);
    const edit = opPreview(deck, ops[0]);
    expect(edit.before?.content.title).toBe('Why caching matters');
    expect(edit.after?.content.title).toBe('Why cache');
    expect(opPreview(deck, ops[2]).before).toBeUndefined();
    expect(opPreview(deck, ops[3]).after).toBeUndefined();
  });
});

describe('what needs a tick', () => {
  it('asks for a tick on deletions and whole rewrites, decided in code', () => {
    const deck = sampleDeck();
    const [del] = propose(deck, (d) => d.delete('s_how', ''));
    expect(needsTick(deck, del)).toBe('Deletes this slide');
    const [small] = propose(deck, (d) => d.editContent('s_how', JSON.stringify({ title: 'How caching works' }), ''));
    expect(needsTick(deck, small)).toBeNull();
    const [rewrite] = propose(deck, (d) => d.editContent('s_how', JSON.stringify({ title: 'Pricing', bullets: ['Plans start small', 'Pay for traffic'] }), ''));
    expect(needsTick(deck, rewrite)).toBe('Rewrites the whole slide');
    const [notes] = propose(deck, (d) => d.editNotes('s_how', { script: 'Something else entirely.' }, ''));
    expect(needsTick(deck, notes)).toBeNull();
    const ops = cutDown(deck);
    expect(needsTick(deck, ops[1])).toBeNull();
    expect(needsTick(deck, ops[2])).toBeNull();
  });

  it('leaves short slides alone: too few words to judge a rewrite', () => {
    const section = slide('s_part', 'section', { title: 'Part two' });
    expect(rewritesSlide(section, { ...section, content: { ...section.content, title: 'Next up' } })).toBe(false);
  });
});

// ─── Undo, through the studio's own editor ────────────────────────────────────

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function editor(deck: Deck) {
  await db.decks.put(deck);
  const host = document.createElement('div');
  const root = createRoot(host);
  const ref: { current: ReturnType<typeof useDeckEditor> | null } = { current: null };
  function Probe() {
    ref.current = useDeckEditor(deck.id);
    return null;
  }
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { ed: () => ref.current!, unmount: () => act(() => root.unmount()) };
}

describe('accepting and undoing', () => {
  afterEach(async () => { await db.decks.clear(); });

  it('Accept all is one undo step', async () => {
    const deck = sampleDeck();
    const { ed, unmount } = await editor(deck);
    expect(ed().deck?.slides).toHaveLength(5);
    const ops = cutDown(deck);
    await act(async () => { ed().change((d) => applyOps(d, ops)); });
    expect(order(ed().deck!)).toEqual(['s_title', 's_why', 's_inval', 's_new1', 's_end']);
    await act(async () => { ed().undo(); });
    expect(ed().deck).toEqual(deck);
    expect(ed().canUndo).toBe(false);
    await act(async () => { ed().redo(); });
    expect(order(ed().deck!)).toEqual(['s_title', 's_why', 's_inval', 's_new1', 's_end']);
    await unmount();
  });

  it('accepting one proposal at a time undoes one at a time', async () => {
    const deck = sampleDeck();
    const { ed, unmount } = await editor(deck);
    const ops = cutDown(deck);
    await act(async () => { ed().change((d) => applyOp(d, ops[0])); });
    await act(async () => { ed().change((d) => applyOp(d, ops[3])); });
    expect(order(ed().deck!)).toEqual(['s_title', 's_why', 's_inval', 's_end']);
    await act(async () => { ed().undo(); });
    expect(order(ed().deck!)).toEqual(['s_title', 's_why', 's_how', 's_inval', 's_end']);
    expect(ed().deck!.slides[1].content.title).toBe('Why cache');
    await act(async () => { ed().undo(); });
    expect(ed().deck).toEqual(deck);
    await unmount();
  });
});

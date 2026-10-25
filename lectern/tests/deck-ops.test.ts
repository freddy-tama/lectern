import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Deck } from '../src/core/deck/types';
import { db } from '../src/data/db';
import { type ToolOutput, runTool } from '../src/features/studio/agent/tools';
import { Workspace } from '../src/features/studio/agent/workspace';
import { type DeckOp, applyOp, applyOps, needsTick, opApplies, opPreview, rewritesSlide } from '../src/features/studio/deck-ops';
import { useDeckEditor } from '../src/features/studio/useDeckEditor';
import { sampleDeck, slide } from './assistant-fixtures';

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const NOTES_NULL = { script: null, keyPoints: null, cues: null, checkQuestion: null, checkAnswer: null, minutes: null };

type Tool = (name: string, input: Record<string, unknown>) => Promise<ToolOutput>;

/** Proposals as the assistant makes them for this deck: its tools on a working copy, then the difference. */
async function propose(deck: Deck, work: (tool: Tool) => Promise<unknown>): Promise<DeckOp[]> {
  const ws = new Workspace(deck);
  await work((name, input) => runTool(name, input, { ws, tag: 't' }));
  return wire(ws.ops());
}

const order = (d: Deck) => d.slides.map((s) => s.id);
const addedId = (ops: DeckOp[], n = 0) => ops.filter((o): o is Extract<DeckOp, { op: 'add' }> => o.op === 'add')[n].slide.id;
const content = (tool: Tool, slideId: string, value: Record<string, unknown>, reason = '') => tool('edit_slide', { slide: slideId, content_json: JSON.stringify(value), reason });
const notes = (tool: Tool, slideId: string, value: Record<string, unknown>, reason = '') => tool('edit_notes', { ...NOTES_NULL, ...value, slide: slideId, reason });
const add = (tool: Tool, after: string, kind: string, value: Record<string, unknown>, minutes: number, reason = '') => tool('add_slide', { after, kind, layout: null, content_json: JSON.stringify(value), script: '', keyPoints: [], minutes, reason });

/** "Cut it down": a shorter title, less time, a summary, a move and a deletion. */
function cutDown(deck: Deck) {
  return propose(deck, async (t) => {
    await content(t, 's_why', { title: 'Why cache' }, 'Shorter');
    await notes(t, 's_why', { minutes: 2 }, 'Fit the time');
    await add(t, 's_inval', 'summary', { title: 'Recap', points: ['Cache reads'] }, 1, 'Recap before the end');
    await t('move_slide', { slide: 's_inval', after: 's_why', reason: 'Problems first' });
    await t('delete_slide', { slide: 's_how', reason: 'Too technical' });
  });
}

describe('applying proposals', () => {
  it('applies edits, a new slide, a move and a deletion in one change, keeping pictures', async () => {
    const deck = sampleDeck();
    const ops = await cutDown(deck);
    expect(ops.map((o) => o.op)).toEqual(['edit', 'move', 'add', 'delete']);
    const after = applyOps(deck, ops);
    const recap = addedId(ops);
    expect(order(after)).toEqual(['s_title', 's_why', 's_inval', recap, 's_end']);
    const why = after.slides[1];
    expect(why.content).toMatchObject({ title: 'Why cache', image: 'asset:pic1', bullets: ['Faster pages', 'Lower hosting cost', 'Less load on the database'] });
    expect(why.notes).toMatchObject({ minutes: 2, script: 'Caching makes pages faster.' });
    expect(after.slides[3]).toMatchObject({ id: recap, kind: 'summary', content: { title: 'Recap', points: ['Cache reads'] }, notes: { minutes: 1 } });
    // The deck that came in is untouched: the change is a new deck, ready to be one undo step.
    expect(order(deck)).toEqual(['s_title', 's_why', 's_how', 's_inval', 's_end']);
  });

  it('takes some proposals and leaves others: a new slide finds its place without its neighbour', async () => {
    const deck = sampleDeck();
    const ops = await propose(deck, async (t) => {
      await add(t, 's_why', 'section', { title: 'Part 2' }, 0.5);
      await add(t, '3', 'bullets', { title: 'Detail' }, 1);
    });
    const [part, detail] = [addedId(ops), addedId(ops, 1)];
    expect(ops[1]).toMatchObject({ op: 'add', after: [part, 's_why', 's_title'] });
    expect(order(applyOp(deck, ops[1]))).toEqual(['s_title', 's_why', detail, 's_how', 's_inval', 's_end']);
  });

  it('lays an edit over later changes by the presenter, field by field', async () => {
    const deck = sampleDeck();
    const [op] = await propose(deck, (t) => content(t, 's_how', { title: 'How caching works' }));
    const edited = { ...deck, slides: deck.slides.map((s) => (s.id === 's_how' ? { ...s, content: { ...s.content, bullets: ['Rewritten by hand'] } } : s)) };
    expect(applyOp(edited, op).slides[2].content).toMatchObject({ title: 'How caching works', bullets: ['Rewritten by hand'] });
  });

  it('applies layouts, arrangements and elements, and takes them away again', async () => {
    const deck = sampleDeck();
    const ops = await propose(deck, async (t) => {
      await t('set_layout', { slide: 's_how', layout: 'columns', kind: null, reason: '' });
      await t('arrange', { slide: 's_why', moves_json: JSON.stringify([{ box: 'image', y: 200, h: 700 }, { box: 'deco-a', hide: true }]), reason: '' });
      await t('add_elements', { slide: 's_title', elements_json: JSON.stringify([{ type: 'decor', motif: 'sprigs', x: 1400, y: 40, w: 480, h: 360, layer: 'back' }, { type: 'text', text: 'Live demo', x: 128, y: 800, w: 500, h: 90 }]), reason: '' });
    });
    const after = applyOps(deck, ops);
    const [title, why, how] = after.slides;
    expect(how.variant).toBe('columns');
    expect(why.overrides).toMatchObject({ image: { y: 200, h: 700 }, 'deco-a': { hidden: true } });
    expect(title.elements?.map((e) => e.type)).toEqual(['decor', 'text']);
    // A later proposal that removes the last element or puts every box back clears them from the slide.
    const undone = await propose(after, async (t) => {
      for (const el of title.elements!) await t('change_element', { slide: 's_title', element: `el-${el.id}`, changes_json: '{}', remove: true, reason: '' });
      await t('arrange', { slide: 's_why', moves_json: JSON.stringify([{ box: 'image', reset: true }, { box: 'deco-a', reset: true }]), reason: '' });
    });
    expect(undone).toEqual([{ op: 'edit', slideId: 's_title', elements: null, reason: '' }, { op: 'edit', slideId: 's_why', overrides: null, reason: '' }]);
    const back = applyOps(after, undone);
    expect(back.slides[0]).not.toHaveProperty('elements');
    expect(back.slides[1]).not.toHaveProperty('overrides');
  });

  it('turns a slide into another type with its content, and pins a chosen layout when the deck styles itself', async () => {
    const deck = { ...sampleDeck(), autoStyle: true };
    const ops = await propose(deck, async (t) => {
      await t('set_layout', { slide: 's_inval', layout: null, kind: 'summary', reason: '' });
      await t('set_layout', { slide: 's_how', layout: 'left', kind: null, reason: '' });
    });
    const after = applyOps(deck, ops);
    expect(after.slides[3]).toMatchObject({ kind: 'summary', content: { title: 'Invalidation' } });
    expect(JSON.stringify(after.slides[3].content)).toContain('Version your keys');
    expect(after.slides[3].content).not.toHaveProperty('bullets');
    expect(after.slides[2]).toMatchObject({ variant: 'left', variantPinned: true });
  });

  it('skips proposals that no longer apply', async () => {
    const deck = sampleDeck();
    const [edit] = await propose(deck, (t) => notes(t, 's_how', { minutes: 1 }));
    const without = { ...deck, slides: deck.slides.filter((s) => s.id !== 's_how') };
    expect(opApplies(without, edit)).toBe(false);
    expect(applyOp(without, edit)).toBe(without);
    const [del] = await propose(deck, (t) => t('delete_slide', { slide: 's_end', reason: '' }));
    const lonely = { ...deck, slides: deck.slides.filter((s) => s.id === 's_end') };
    expect(applyOp(lonely, del)).toBe(lonely);
  });

  it('previews each proposal before and after', async () => {
    const deck = sampleDeck();
    const ops = await cutDown(deck);
    const edit = opPreview(deck, ops[0]);
    expect(edit.before?.content.title).toBe('Why caching matters');
    expect(edit.after?.content.title).toBe('Why cache');
    expect(opPreview(deck, ops[2]).before).toBeUndefined();
    expect(opPreview(deck, ops[3]).after).toBeUndefined();
  });
});

describe('what needs a tick', () => {
  it('asks for a tick on deletions and whole rewrites, decided in code', async () => {
    const deck = sampleDeck();
    const one = async (work: (t: Tool) => Promise<unknown>) => (await propose(deck, work))[0];
    expect(needsTick(deck, await one((t) => t('delete_slide', { slide: 's_how', reason: '' })))).toBe('Deletes this slide');
    expect(needsTick(deck, await one((t) => content(t, 's_how', { title: 'How caching works' })))).toBeNull();
    expect(needsTick(deck, await one((t) => content(t, 's_how', { title: 'Pricing', bullets: ['Plans start small', 'Pay for traffic'] })))).toBe('Rewrites the whole slide');
    expect(needsTick(deck, await one((t) => notes(t, 's_how', { script: 'Something else entirely.' })))).toBeNull();
    expect(needsTick(deck, await one((t) => t('set_layout', { slide: 's_how', layout: 'columns', kind: null, reason: '' })))).toBeNull();
    const ops = await cutDown(deck);
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
    const ops = await cutDown(deck);
    const recap = addedId(ops);
    await act(async () => { ed().change((d) => applyOps(d, ops)); });
    expect(order(ed().deck!)).toEqual(['s_title', 's_why', 's_inval', recap, 's_end']);
    await act(async () => { ed().undo(); });
    expect(ed().deck).toEqual(deck);
    expect(ed().canUndo).toBe(false);
    await act(async () => { ed().redo(); });
    expect(order(ed().deck!)).toEqual(['s_title', 's_why', 's_inval', recap, 's_end']);
    await unmount();
  });

  it('accepting one proposal at a time undoes one at a time', async () => {
    const deck = sampleDeck();
    const { ed, unmount } = await editor(deck);
    const ops = await cutDown(deck);
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

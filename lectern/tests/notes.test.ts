import { describe, expect, it } from 'vitest';
import type { Lesson, Note } from '../src/data/db';
import {
  applyFilter, defaultsFor, filterFromParams, filterToParams, isFiltering, lessonOver, lessonsByWeek, linkCourse, linkDeck, linkLesson, tagCounts,
} from '../src/features/notes/filters';
import { applyEdit, continueList, insertTask, parseBlocks, parseInline, safeHref, splitCapture } from '../src/features/notes/markdown';

const note = (patch: Partial<Note>): Note => ({ id: 'n', title: '', body: '', tags: [], createdAt: 0, updatedAt: 0, ...patch });

describe('note markdown', () => {
  it('parses blocks with the body line of every task', () => {
    const blocks = parseBlocks('# Plan\nIntro line\nstill intro\n\n- [ ] Print cards\n- [x] Book room\n- loose point\n\n1. First\n2. Second\n> Quote\n---');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'rule']);
    const tasks = blocks[2];
    expect(tasks.type === 'list' && tasks.items.map((i) => [i.line, i.text, i.task?.done])).toEqual([[4, 'Print cards', false], [5, 'Book room', true], [6, 'loose point', undefined]]);
    expect(blocks[3].type === 'list' && blocks[3].ordered).toBe(true);
    expect(blocks[1].type === 'paragraph' && blocks[1].lines).toEqual(['Intro line', 'still intro']);
  });

  it('parses inline marks and keeps only safe links', () => {
    expect(parseInline('a **bold** and _soft_ `x`')).toEqual([
      { t: 'text', v: 'a ' }, { t: 'bold', c: [{ t: 'text', v: 'bold' }] }, { t: 'text', v: ' and ' },
      { t: 'italic', c: [{ t: 'text', v: 'soft' }] }, { t: 'text', v: ' ' }, { t: 'code', v: 'x' },
    ]);
    expect(parseInline('[map](https://example.com/a)')[0]).toMatchObject({ t: 'link', href: 'https://example.com/a' });
    expect(parseInline('[bad](javascript:alert(1))').some((p) => p.t === 'link')).toBe(false);
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }]);
    expect(parseInline('see https://example.com.')[1]).toMatchObject({ t: 'link', href: 'https://example.com' });
    expect(safeHref('/lessons/l1')).toBe('/lessons/l1');
    expect(safeHref('//evil.example')).toBeNull();
  });

  it('continues lists on Enter and ends them on an empty item', () => {
    const run = (text: string) => { const e = continueList(text, text.length); return e && applyEdit(text, e).value; };
    expect(run('- point')).toBe('- point\n- ');
    expect(run('- [x] done')).toBe('- [x] done\n- [ ] ');
    expect(run('  3. third')).toBe('  3. third\n  4. ');
    expect(run('a\n- ')).toBe('a\n');
    expect(run('plain')).toBeNull();
  });

  it('inserts a task on an empty line or below the current one', () => {
    expect(applyEdit('Hi', insertTask('Hi', 2)).value).toBe('Hi\n- [ ] ');
    expect(applyEdit('Hi\n', insertTask('Hi\n', 3))).toEqual({ value: 'Hi\n- [ ] ', cursor: 9 });
  });

  it('splits quick capture text into a title and body', () => {
    expect(splitCapture('\n# Bring thermometers\n\n- [ ] two of them')).toEqual({ title: 'Bring thermometers', body: '- [ ] two of them' });
    expect(splitCapture('- [ ] email parents')).toEqual({ title: '', body: '- [ ] email parents' });
    expect(splitCapture('   ')).toEqual({ title: '', body: '' });
  });
});

describe('note filters', () => {
  const notes = [
    note({ id: 'a', title: 'Plan', courseId: 'c1', lessonId: 'l1', tags: ['planning'], body: '- [ ] print' }),
    note({ id: 'b', title: 'Reflection', courseId: 'c1', tags: ['reflection'], date: '2026-10-20', body: '- [x] done' }),
    note({ id: 'c', title: 'Idea', tags: ['idea'], deckId: 'd1', slideId: 's1' }),
  ];

  it('round-trips through the address bar', () => {
    const f = filterFromParams(new URLSearchParams('course=c1&tag=%23Planning&tasks=1&q=print'));
    expect(f).toEqual({ q: 'print', course: 'c1', tag: 'planning', tasks: true });
    expect(filterToParams(f).toString()).toBe('q=print&course=c1&tag=planning&tasks=1');
    expect(isFiltering({ q: '' })).toBe(false);
  });

  it('narrows by links, tags, tasks, dates and words', () => {
    const ids = (f: Parameters<typeof applyFilter>[1]) => applyFilter(notes, f).map((n) => n.id);
    expect(ids({ q: '', course: 'c1' })).toEqual(['a', 'b']);
    expect(ids({ q: '', tasks: true })).toEqual(['a']);
    expect(ids({ q: '', dated: true })).toEqual(['b']);
    expect(ids({ q: '', linked: true })).toEqual(['a']);
    expect(ids({ q: '', deck: 'd1', slide: 's1' })).toEqual(['c']);
    expect(ids({ q: '#idea' })).toEqual(['c']);
    expect(tagCounts([...notes, note({ tags: ['idea'] })])[0]).toEqual({ tag: 'idea', count: 2 });
  });

  it('keeps links consistent when picking a course, lesson or deck', () => {
    const refs = {
      lesson: new Map([['l1', { id: 'l1', courseId: 'c1', deckId: 'd1' }], ['l2', { id: 'l2', courseId: 'c2' }]]),
      deck: new Map([['d1', { id: 'd1', lessonId: 'l1' }], ['d2', { id: 'd2' }]]),
    };
    expect(linkLesson({}, 'l1', refs)).toEqual({ lessonId: 'l1', courseId: 'c1', deckId: 'd1' });
    expect(linkLesson({ deckId: 'd2' }, 'l1', refs)).toEqual({ lessonId: 'l1', courseId: 'c1' });
    expect(linkCourse({ lessonId: 'l1' }, 'c2', refs)).toEqual({ courseId: 'c2', lessonId: undefined });
    expect(linkCourse({ lessonId: 'l1' }, 'c1', refs)).toEqual({ courseId: 'c1' });
    expect(linkDeck({ slideId: 's1' }, 'd1', refs)).toEqual({ deckId: 'd1', slideId: undefined, lessonId: 'l1', courseId: 'c1' });
    expect(defaultsFor({ q: '', lesson: 'l1', tag: 'planning' }, refs)).toEqual({ lessonId: 'l1', courseId: 'c1', deckId: 'd1', tags: ['planning'] });
  });

  it('knows when a lesson is over', () => {
    const now = new Date(2026, 9, 19, 10, 0);
    expect(lessonOver({ date: '2026-10-18' }, '2026-10-19', now)).toBe(true);
    expect(lessonOver({ date: '2026-10-19', time: '09:00', durationMinutes: 45 }, '2026-10-19', now)).toBe(true);
    expect(lessonOver({ date: '2026-10-19', time: '09:30', durationMinutes: 45 }, '2026-10-19', now)).toBe(false);
    expect(lessonOver({}, '2026-10-19', now)).toBe(false);
  });

  it('groups lessons by week in teaching order', () => {
    const l = (id: string, week: number, date?: string, order = 0) => ({ id, week, date, order, courseId: 'c', title: id, summary: '', createdAt: 0, updatedAt: 0 }) as Lesson;
    const groups = lessonsByWeek([l('b', 2, '2026-10-09'), l('a', 1, '2026-10-02'), l('c', 2, '2026-10-07')], { weekTitles: { 2: 'Storms' } });
    expect(groups.map((g) => [g.label, g.lessons.map((x) => x.id)])).toEqual([['Week 1', ['a']], ['Week 2 · Storms', ['c', 'b']]]);
  });
});

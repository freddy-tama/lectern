// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fieldAt, getAt, insertItem, isListItem, isTextBind, removeItem, setAt, splitBind } from '../src/core/deck/paths';
import type { FieldSpec } from '../src/core/kinds/types';

const FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'body', label: 'Text', type: 'textarea' },
  { key: 'bullets', label: 'Points', type: 'list', itemLabel: 'Point' },
  { key: 'stats', label: 'Numbers', type: 'objects', itemLabel: 'Number', fields: [{ key: 'value', label: 'Value', type: 'text' }, { key: 'on', label: 'On', type: 'toggle' }] },
  { key: 'image', label: 'Picture', type: 'image' },
];

const content = { title: 'Hello', bullets: ['a', 'b', 'c'], stats: [{ value: '62%' }, { value: '5' }], image: 'asset:1' };

describe('content paths', () => {
  it('splits binds into keys and indexes', () => {
    expect(splitBind('stats.1.value')).toEqual(['stats', 1, 'value']);
    expect(splitBind('title')).toEqual(['title']);
  });

  it('reads values at a path', () => {
    expect(getAt(content, 'bullets.2')).toBe('c');
    expect(getAt(content, 'stats.1.value')).toBe('5');
    expect(getAt(content, 'stats.9.value')).toBeUndefined();
    expect(getAt(content, 'title.0.x')).toBeUndefined();
  });

  it('writes a copy, leaving the original and untouched branches alone', () => {
    const next = setAt(content, 'stats.0.value', '70%');
    expect(getAt(next, 'stats.0.value')).toBe('70%');
    expect(content.stats[0].value).toBe('62%');
    expect(next.stats).not.toBe(content.stats);
    expect(next.bullets).toBe(content.bullets);
    expect(setAt({}, 'bullets.1', 'x')).toEqual({ bullets: ['', 'x'] });
  });

  it('finds the field behind a path', () => {
    expect(fieldAt(FIELDS, 'bullets.1')?.key).toBe('bullets');
    expect(fieldAt(FIELDS, 'stats.0.value')?.key).toBe('value');
    expect(fieldAt(FIELDS, 'stats.0')).toBeUndefined();
    expect(fieldAt(FIELDS, 'nope')).toBeUndefined();
  });

  it('knows which text can be typed on the slide', () => {
    expect(isTextBind(FIELDS, content, 'title')).toBe(true);
    expect(isTextBind(FIELDS, content, 'body')).toBe(true);
    expect(isTextBind(FIELDS, content, 'bullets.0')).toBe(true);
    expect(isTextBind(FIELDS, content, 'bullets')).toBe(false);
    expect(isTextBind(FIELDS, content, 'stats.1.value')).toBe(true);
    expect(isTextBind(FIELDS, content, 'image')).toBe(false);
    expect(isTextBind(FIELDS, { title: 3 }, 'title')).toBe(false);
    expect(isListItem(FIELDS, 'bullets.2')).toBe(true);
    expect(isListItem(FIELDS, 'stats.0.value')).toBe(false);
  });

  it('adds and removes list items', () => {
    expect(insertItem(content, 'bullets', 0).bullets).toEqual(['a', '', 'b', 'c']);
    expect(removeItem(content, 'bullets', 1).bullets).toEqual(['a', 'c']);
    expect(content.bullets).toEqual(['a', 'b', 'c']);
  });
});

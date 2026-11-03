// A slide finished elsewhere (PowerPoint, Keynote, Google Slides), kept exactly as it was
// designed: a picture of the whole slide, with no layout, decoration or footer added.
// Its words are kept beside the picture, for key notes, search and screen readers.
// It can carry a quiz question: phones answer it while the slide is up, and the next
// click shows the answer over the picture.

import type { Box } from '../engine/boxes';
import { CANVAS_H, CANVAS_W } from '../engine/boxes';
import { M, imageSrc, read, shape, text } from './kit';
import type { AnyKind, KindLayout, SlideKindDefinition } from './types';

type C = Record<string, unknown>;

const LETTERS = 'ABCDEF';

/** The quiz choices, blanks skipped, as pollChoices() counts them. */
function choices(c: C): string[] {
  return read.list(c, 'options').map((o) => o.trim()).filter(Boolean).slice(0, 6);
}

const designed: SlideKindDefinition<C> = {
  kind: 'designed', label: 'Designed slide', group: 'Visual', icon: 'presentation',
  description: 'A slide made in PowerPoint, Keynote or Google Slides, shown exactly as it was designed. Give it a quiz question to ask on phones.',
  draft: false,
  fields: [
    { key: 'image', label: 'Slide picture', type: 'image' },
    { key: 'title', label: 'Title', type: 'text', help: 'Names the slide in the studio and on your phone. Not shown on the slide.' },
    { key: 'question', label: 'Quiz question', type: 'textarea', rows: 2, help: 'Optional. Phones answer it while this slide is up; your next click shows the answer.' },
    { key: 'options', label: 'Choices', type: 'list', itemLabel: 'Choice', max: 6, correctKey: 'correct', help: 'Mark the right choice, or none for a poll.' },
    { key: 'text', label: 'Words on the slide', type: 'textarea', rows: 5, more: true, ai: false, help: 'Read from your file, for key notes, search and screen readers. Changing it doesn’t change the picture.' },
  ],
  create: () => ({ image: '', title: '', question: '', options: [], correct: -1, text: '' }),
  heading: (c) => read.str(c, 'title').trim() || read.str(c, 'text').trim().split('\n')[0]?.slice(0, 70) || 'Designed slide',
  text: (c) => [read.str(c, 'text'), read.str(c, 'question'), ...choices(c)].filter((s) => s.trim()),
  layout(c, ctx): KindLayout {
    const src = imageSrc(ctx, c.image);
    const boxes: Box[] = [];
    if (src) {
      const alt = read.str(c, 'text').replace(/\s+/g, ' ').trim().slice(0, 240) || read.str(c, 'title');
      boxes.push({ type: 'image', id: 'image', src, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, fit: 'contain', bind: 'image', alt });
    } else {
      boxes.push(shape({ id: 'image-ph', shape: 'rect', x: M.x, y: M.top, w: M.w, h: M.bottom - M.top, fill: '#1B1B1B', stroke: '#5A5A5A', strokeWidth: 3, radius: 24, dash: true, bind: 'image' }));
      boxes.push(text(ctx, { id: 'image-hint', text: 'Add a picture of the slide', x: M.x, y: CANVAS_H / 2 - 40, w: M.w, h: 80, max: 40, min: 28, color: '#BBBBBB', align: 'center', valign: 'middle', scaled: false, bind: 'image' }));
    }
    const list = choices(c);
    const correct = read.num(c, 'correct');
    if (list.length >= 2 && Number.isInteger(correct) && correct >= 0 && correct < list.length) {
      // The answer, on the click after the question: phones lock their answers then.
      const h = 128;
      const y = CANVAS_H - 72 - h;
      const good = ctx.theme.colors.good;
      boxes.push(shape({ id: 'answer-card', shape: 'rect', x: M.x, y, w: M.w, h, fill: '#FFFFFF', stroke: good, strokeWidth: 6, radius: 28, step: 1, reveal: 'answer', opacity: 0.97 }));
      boxes.push(shape({ id: 'answer-ok', shape: 'ellipse', x: M.x + 32, y: y + 24, w: h - 48, h: h - 48, fill: good, step: 1, reveal: 'answer' }));
      boxes.push({ type: 'text', id: 'answer-tick', x: M.x + 32, y: y + 24, w: h - 48, h: h - 48, text: '✓', step: 1, reveal: 'answer',
        style: { font: 'body', size: 46, weight: 800, color: '#FFFFFF', align: 'center', valign: 'middle', lineHeight: 1 } });
      boxes.push(text(ctx, { id: 'answer', text: `${LETTERS[correct]} · ${list[correct]}`, x: M.x + h + 16, y: y + 14, w: M.w - h - 48, h: h - 28, max: 52, min: 28, maxLines: 2, color: '#1B1B1B', valign: 'middle', scaled: false, step: 1, reveal: 'answer' }));
    }
    return { boxes, frame: 'bare', background: '#000000' };
  },
};

export const DESIGNED_KINDS: AnyKind[] = [designed];

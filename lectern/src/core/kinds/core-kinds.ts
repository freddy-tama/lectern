// The built-in slide kinds. Plugins register more through the same contract.

import { type Box, CANVAS_H, CANVAS_W } from '../engine/boxes';
import { fontWeight } from '../engine/themes';
import { M, type LayoutContext, card, heightAt, imageSrc, list, read, shape, slideTitle, sz, text } from './kit';
import { DATA_KINDS } from './data-kinds';
import { registerKind } from './registry';
import type { AnyKind, SlideKindDefinition } from './types';
import { VISUAL_KINDS } from './visual-kinds';

type C = Record<string, unknown>;

function imageOrPlaceholder(ctx: LayoutContext, id: string, src: string, x: number, y: number, w: number, h: number, radius = ctx.theme.radius, bind = 'image'): Box[] {
  if (src) return [{ type: 'image', id, src, x, y, w, h, fit: 'cover', radius, bind }];
  if (ctx.mode !== 'edit') return [];
  return [
    shape({ id: `${id}-ph`, shape: 'rect', x, y, w, h, fill: ctx.theme.colors.surface, stroke: ctx.theme.colors.line, strokeWidth: 3, radius, dash: true, bind }),
    text(ctx, { id: `${id}-ph-t`, text: 'Add an image', x, y: y + h / 2 - 30, w, h: 60, max: 30, min: 24, color: ctx.theme.colors.muted, align: 'center', scaled: false, bind }),
  ];
}

function eyebrow(ctx: LayoutContext, id: string, value: string, x: number, y: number, w: number, color = ctx.theme.colors.accent, bind?: string) {
  return text(ctx, { id, text: value, x, y, w, h: sz(ctx, 34) * 1.4, max: 30, min: 22, weight: 700, color, tracking: 0.12, uppercase: true, hug: true, maxLines: 1, bind });
}

// ─── Open ─────────────────────────────────────────────────────────────

const title: SlideKindDefinition<C> = {
  kind: 'title', label: 'Title', description: 'Opens the deck: title, subtitle and who is presenting.', icon: 'presentation', group: 'Open',
  variants: [{ id: 'left', label: 'Left aligned' }, { id: 'center', label: 'Centred' }],
  fields: [
    { key: 'eyebrow', label: 'Above the title', type: 'text', placeholder: 'Event, team or date' },
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'subtitle', label: 'Subtitle', type: 'textarea', rows: 2 },
    { key: 'presenter', label: 'Presenter or date', type: 'text' },
    { key: 'image', label: 'Image', type: 'image', help: 'Shown beside the title in the left-aligned layout.' },
  ],
  create: () => ({ eyebrow: '', title: 'Untitled deck', subtitle: '', presenter: '', image: '' }),
  heading: (c) => read.str(c, 'title') || 'Title',
  text: (c) => [read.str(c, 'eyebrow'), read.str(c, 'title'), read.str(c, 'subtitle'), read.str(c, 'presenter')].filter(Boolean),
  layout(c, ctx, variant) {
    const centered = variant === 'center';
    const src = centered ? '' : imageSrc(ctx, c.image);
    const w = src ? 900 : centered ? M.w : M.w - 240;
    const x = centered ? M.x : M.x;
    const align = centered ? 'center' as const : 'left' as const;
    const parts: Box[] = [];
    const eb = read.str(c, 'eyebrow');
    const t = text(ctx, { id: 'title', text: read.str(c, 'title') || ' ', x, y: 0, w, h: 520, role: 'display', max: 136, min: 72, maxLines: 4, hug: true, align, bind: 'title' });
    const sub = read.str(c, 'subtitle');
    const s = sub ? text(ctx, { id: 'subtitle', text: sub, x, y: 0, w: Math.min(w, 1300), h: 220, max: 46, min: 32, color: ctx.theme.colors.muted, hug: true, maxLines: 3, align, bind: 'subtitle' }) : null;
    const e = eb ? eyebrow(ctx, 'eyebrow', eb, x, 0, w, ctx.theme.colors.accent, 'eyebrow') : null;
    if (e) e.style.align = align;
    const gap1 = sz(ctx, 28);
    const gap2 = sz(ctx, 36);
    const blockH = (e ? e.h + gap1 : 0) + t.h + (s ? gap2 + s.h : 0);
    let y = Math.max(M.top + 40, (CANVAS_H - blockH) / 2 - 30);
    if (e) { e.y = y; parts.push(e); y += e.h + gap1; }
    t.y = y; parts.push(t); y += t.h;
    if (s) { s.y = y + gap2; if (centered) s.x = (CANVAS_W - s.w) / 2; parts.push(s); }
    const presenter = read.str(c, 'presenter');
    if (presenter) parts.push(text(ctx, { id: 'presenter', text: presenter, x, y: M.bottom - 40, w, h: 48, max: 30, min: 24, weight: 600, color: ctx.theme.colors.muted, maxLines: 1, align, bind: 'presenter' }));
    // The image is optional here, so an empty one draws nothing (no placeholder over the title).
    if (src) parts.push({ type: 'image', id: 'image', src, x: 1110, y: 0, w: CANVAS_W - 1110, h: CANVAS_H, fit: 'cover', bind: 'image' });
    return { boxes: parts, frame: src ? 'bare' : 'title' };
  },
};

const section: SlideKindDefinition<C> = {
  kind: 'section', label: 'Section', description: 'A divider that starts a new part of the deck.', icon: 'bookmark', group: 'Open',
  fields: [
    { key: 'number', label: 'Number', type: 'text', placeholder: '02' },
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'subtitle', label: 'Subtitle', type: 'text' },
  ],
  create: () => ({ number: '', title: 'New section', subtitle: '' }),
  heading: (c) => read.str(c, 'title') || 'Section',
  text: (c) => [read.str(c, 'title'), read.str(c, 'subtitle')].filter(Boolean),
  layout(c, ctx) {
    const ink = ctx.theme.colors.sectionInk;
    const boxes: Box[] = [];
    const num = read.str(c, 'number');
    const t = text(ctx, { id: 'title', text: read.str(c, 'title') || ' ', x: M.x, y: 0, w: M.w - 200, h: 420, role: 'display', max: 124, min: 72, maxLines: 3, hug: true, color: ink, bind: 'title' });
    const n = num ? text(ctx, { id: 'number', text: num, x: M.x, y: 0, w: 600, h: 230, role: 'display', max: 200, min: 140, maxLines: 1, hug: true, color: ink, bind: 'number' }) : null;
    if (n) n.opacity = 0.38;
    const sub = read.str(c, 'subtitle');
    const s = sub ? text(ctx, { id: 'subtitle', text: sub, x: M.x, y: 0, w: 1300, h: 160, max: 44, min: 30, color: ink, hug: true, maxLines: 2, bind: 'subtitle' }) : null;
    if (s) s.opacity = 0.78;
    const blockH = (n ? n.h + 8 : 0) + t.h + (s ? 36 + s.h : 0);
    let y = (CANVAS_H - blockH) / 2;
    if (n) { n.y = y; boxes.push(n); y += n.h + 8; }
    t.y = y; boxes.push(t); y += t.h;
    if (s) { s.y = y + 36; boxes.push(s); }
    return { boxes, frame: 'section', background: ctx.theme.colors.sectionBg };
  },
};

const agenda: SlideKindDefinition<C> = {
  kind: 'agenda', label: 'Agenda', description: 'What the session covers, in order.', icon: 'list-ordered', group: 'Open',
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'items', label: 'Items', type: 'list', itemLabel: 'Item', max: 7 },
  ],
  create: () => ({ title: 'Today', items: ['The problem', 'What we found', 'What it means', 'Next steps'] }),
  heading: (c) => read.str(c, 'title') || 'Agenda',
  text: (c) => [read.str(c, 'title'), ...read.list(c, 'items')],
  layout(c, ctx) {
    const t = text(ctx, { id: 'title', text: read.str(c, 'title') || 'Today', x: M.x, y: 0, w: 520, h: 400, role: 'display', max: 104, min: 64, maxLines: 3, hug: true, bind: 'title' });
    t.y = (CANVAS_H - t.h) / 2 - 20;
    const listX = 760;
    const boxes: Box[] = [
      t,
      shape({ id: 'rule', shape: 'rect', x: M.x, y: t.y + t.h + 28, w: 96, h: 10, radius: 5, fill: ctx.theme.colors.accent }),
      ...list(ctx, read.list(c, 'items'), { x: listX, y: M.top + 30, w: M.right - listX, h: M.bottom - M.top - 90, marker: 'number', bindKey: 'items', vcenter: true, max: 50, min: 32 }),
    ];
    return { boxes };
  },
};

// ─── Teach ────────────────────────────────────────────────────────────

const bullets: SlideKindDefinition<C> = {
  kind: 'bullets', label: 'Points', description: 'A title with a few short points, optionally beside an image.', icon: 'list', group: 'Explain',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'bullets', label: 'Points', type: 'list', itemLabel: 'Point', max: 8 },
    { key: 'reveal', label: 'Reveal points one at a time', type: 'toggle' },
    { key: 'image', label: 'Image', type: 'image' },
  ],
  create: () => ({ title: 'Main idea', bullets: ['First point', 'Second point', 'Third point'], reveal: false, image: '' }),
  heading: (c) => read.str(c, 'title') || 'Points',
  text: (c) => [read.str(c, 'title'), ...read.list(c, 'bullets')],
  layout(c, ctx) {
    const src = imageSrc(ctx, c.image);
    const textW = src ? Math.round(M.w * 0.55) : M.w;
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'), { w: src ? textW : M.w - 120 });
    const boxes: Box[] = [box];
    boxes.push(...list(ctx, read.list(c, 'bullets'), {
      x: M.x, y: bottom, w: textW, h: M.bottom - bottom - 30, bindKey: 'bullets', reveal: read.bool(c, 'reveal'), vcenter: true,
    }));
    if (src) {
      const ix = M.x + textW + 80;
      boxes.push(...imageOrPlaceholder(ctx, 'image', src, ix, M.top + 20, M.right - ix, M.bottom - M.top - 60));
    }
    return { boxes };
  },
};

const compare: SlideKindDefinition<C> = {
  kind: 'compare', label: 'Compare', description: 'Two columns side by side: before and after, pros and cons, A and B.', icon: 'columns-2', group: 'Explain',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'leftHeading', label: 'Left heading', type: 'text' },
    { key: 'leftPoints', label: 'Left points', type: 'list', itemLabel: 'Point', max: 6 },
    { key: 'rightHeading', label: 'Right heading', type: 'text' },
    { key: 'rightPoints', label: 'Right points', type: 'list', itemLabel: 'Point', max: 6 },
    { key: 'reveal', label: 'Show the right column on click', type: 'toggle' },
  ],
  create: () => ({ title: 'Two ways to look at it', leftHeading: 'Option A', leftPoints: ['A point'], rightHeading: 'Option B', rightPoints: ['A point'], reveal: false }),
  heading: (c) => read.str(c, 'title') || 'Compare',
  text: (c) => [read.str(c, 'title'), read.str(c, 'leftHeading'), ...read.list(c, 'leftPoints'), read.str(c, 'rightHeading'), ...read.list(c, 'rightPoints')],
  layout(c, ctx) {
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    const gap = 56;
    const colW = (M.w - gap) / 2;
    const top = bottom;
    const h = M.bottom - top - 20;
    const pad = 52;
    (['left', 'right'] as const).forEach((side, i) => {
      const x = M.x + i * (colW + gap);
      const step = side === 'right' && read.bool(c, 'reveal') ? 1 : undefined;
      boxes.push(card(ctx, `${side}-card`, x, top, colW, h, { step }));
      const head = read.str(c, `${side}Heading`);
      let y = top + pad;
      if (head) {
        const hb = text(ctx, { id: `${side}-head`, text: head, x: x + pad, y, w: colW - pad * 2, h: 140, role: 'display', max: 54, min: 38, maxLines: 2, hug: true, color: i ? ctx.theme.colors.accent : ctx.theme.colors.ink, step, bind: `${side}Heading` });
        boxes.push(hb);
        y += hb.h + 24;
        boxes.push(shape({ id: `${side}-rule`, shape: 'rect', x: x + pad, y, w: colW - pad * 2, h: 3, fill: ctx.theme.colors.line, step }));
        y += 36;
      }
      boxes.push(...list(ctx, read.list(c, `${side}Points`), { x: x + pad, y, w: colW - pad * 2, h: top + h - pad - y, bindKey: `${side}Points`, max: 40, min: 28, reveal: false, startStep: step }).map((b) => ({ ...b, step })));
    });
    return { boxes };
  },
};

const image: SlideKindDefinition<C> = {
  kind: 'image', label: 'Image', description: 'A picture with a short explanation, or full-bleed with a caption.', icon: 'image', group: 'Visual',
  variants: [{ id: 'right', label: 'Image right' }, { id: 'left', label: 'Image left' }, { id: 'full', label: 'Full picture' }],
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'body', label: 'Text', type: 'textarea', rows: 4 },
    { key: 'image', label: 'Image', type: 'image' },
    { key: 'caption', label: 'Caption or credit', type: 'text' },
    { key: 'whole', label: 'Show the whole image', type: 'toggle', help: 'Fits diagrams and charts without cropping their edges.' },
  ],
  create: () => ({ title: 'Look closely', body: 'What stands out?', image: '', caption: '', whole: false }),
  heading: (c) => read.str(c, 'title') || 'Image',
  text: (c) => [read.str(c, 'title'), read.str(c, 'body'), read.str(c, 'caption')].filter(Boolean),
  layout(c, ctx, variant) {
    const src = imageSrc(ctx, c.image);
    const caption = read.str(c, 'caption');
    if (variant === 'full' && src) {
      const boxes: Box[] = [
        { type: 'image', id: 'image', src, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, fit: 'cover', bind: 'image' },
        shape({ id: 'scrim', shape: 'rect', x: 0, y: CANVAS_H - 380, w: CANVAS_W, h: 380, fill: '#000000', opacity: 0.55 }),
      ];
      const t = text(ctx, { id: 'title', text: read.str(c, 'title') || ' ', x: M.x, y: CANVAS_H - 330, w: M.w, h: 190, role: 'display', max: 84, min: 52, maxLines: 2, color: '#FFFFFF', valign: 'bottom', bind: 'title' });
      boxes.push(t);
      const body = read.str(c, 'body');
      if (body) boxes.push(text(ctx, { id: 'body', text: body, x: M.x, y: CANVAS_H - 132, w: M.w, h: 60, max: 36, min: 26, maxLines: 1, color: '#FFFFFF', bind: 'body' }));
      if (caption) boxes.push(text(ctx, { id: 'caption', text: caption, x: M.right - 700, y: 30, w: 700, h: 36, max: 22, min: 18, scaled: false, color: '#FFFFFF', align: 'right', bind: 'caption' }));
      return { boxes, frame: 'bare' };
    }
    const left = variant === 'left';
    const half = CANVAS_W / 2;
    const textX = src || ctx.mode === 'edit' ? (left ? half + 96 : M.x) : M.x;
    const textW = src || ctx.mode === 'edit' ? half - M.x - 96 : M.w;
    const boxes: Box[] = [];
    const t = text(ctx, { id: 'title', text: read.str(c, 'title') || ' ', x: textX, y: 0, w: textW, h: 300, role: 'display', max: 80, min: 50, maxLines: 3, hug: true, bind: 'title' });
    const body = read.str(c, 'body');
    const b = body ? text(ctx, { id: 'body', text: body, x: textX, y: 0, w: textW, h: 520, max: 44, min: 30, hug: true, color: ctx.theme.colors.muted, bind: 'body' }) : null;
    const blockH = t.h + (b ? 40 + b.h : 0);
    let y = Math.max(M.top, (CANVAS_H - blockH) / 2 - 20);
    t.y = y; boxes.push(t); y += t.h + 40;
    if (b) { b.y = y; boxes.push(b); }
    if (src && read.bool(c, 'whole')) {
      boxes.push(shape({ id: 'image-bg', shape: 'rect', x: left ? 0 : half, y: 0, w: half, h: CANVAS_H, fill: ctx.theme.colors.surface }));
      boxes.push({ type: 'image', id: 'image', src, x: (left ? 0 : half) + 48, y: 48, w: half - 96, h: CANVAS_H - 96, fit: 'contain', bind: 'image' });
    } else boxes.push(...imageOrPlaceholder(ctx, 'image', src, left ? 0 : half, 0, half, CANVAS_H, 0));
    if (caption && src) boxes.push(text(ctx, { id: 'caption', text: caption, x: left ? 40 : half + 40, y: CANVAS_H - 70, w: half - 80, h: 40, max: 22, min: 18, scaled: false, color: read.bool(c, 'whole') ? ctx.theme.colors.muted : '#FFFFFF', align: left ? 'left' : 'right', bind: 'caption' }));
    else if (caption) boxes.push(text(ctx, { id: 'caption', text: caption, x: textX, y: M.bottom - 30, w: textW, h: 40, max: 24, min: 20, scaled: false, color: ctx.theme.colors.muted, bind: 'caption' }));
    return { boxes, frame: src ? 'bare' : 'content' };
  },
};

const quote: SlideKindDefinition<C> = {
  kind: 'quote', label: 'Quote', description: 'A quotation or a key sentence, large.', icon: 'quote', group: 'Explain',
  fields: [
    { key: 'quote', label: 'Quote', type: 'textarea', rows: 4 },
    { key: 'attribution', label: 'Who said it', type: 'text' },
  ],
  create: () => ({ quote: 'The important thing is not to stop questioning.', attribution: 'Albert Einstein' }),
  heading: (c) => read.str(c, 'quote').slice(0, 60) || 'Quote',
  text: (c) => [read.str(c, 'quote'), read.str(c, 'attribution')].filter(Boolean),
  layout(c, ctx) {
    const boxes: Box[] = [
      text(ctx, { id: 'mark', text: '“', x: M.x - 16, y: M.top - 40, w: 300, h: 340, role: 'display', max: 320, min: 320, scaled: false, color: ctx.theme.colors.accent, lh: 1 }),
    ];
    const q = text(ctx, { id: 'quote', text: read.str(c, 'quote') || ' ', x: M.x + 40, y: 0, w: M.w - 200, h: 600, role: 'display', italic: ctx.theme.display.web.includes('Fraunces'), max: 84, min: 46, hug: true, lh: 1.18, bind: 'quote' });
    const who = read.str(c, 'attribution');
    const a = who ? text(ctx, { id: 'attribution', text: `— ${who}`, x: M.x + 40, y: 0, w: M.w - 200, h: 60, max: 36, min: 28, weight: 600, color: ctx.theme.colors.muted, hug: true, maxLines: 1, bind: 'attribution' }) : null;
    const blockH = q.h + (a ? 48 + a.h : 0);
    q.y = Math.max(300, (CANVAS_H - blockH) / 2 + 40);
    boxes.push(q);
    if (a) { a.y = q.y + q.h + 48; boxes.push(a); }
    return { boxes };
  },
};

const term: SlideKindDefinition<C> = {
  kind: 'term', label: 'Key term', description: 'One term, its meaning and an example. Good for vocabulary, jargon or product terms.', icon: 'book-open', group: 'Explain',
  fields: [
    { key: 'label', label: 'Label', type: 'text', placeholder: 'Key term, noun, formula…' },
    { key: 'term', label: 'Term', type: 'text' },
    { key: 'definition', label: 'Meaning', type: 'textarea', rows: 3 },
    { key: 'example', label: 'Example', type: 'textarea', rows: 2 },
    { key: 'image', label: 'Image', type: 'image' },
  ],
  create: () => ({ label: 'Key term', term: 'Photosynthesis', definition: 'How plants use light to turn water and carbon dioxide into food.', example: 'A leaf in sunlight makes sugar and gives off oxygen.', image: '' }),
  heading: (c) => read.str(c, 'term') || 'Key term',
  text: (c) => [read.str(c, 'term'), read.str(c, 'definition'), read.str(c, 'example')].filter(Boolean),
  layout(c, ctx) {
    const src = imageSrc(ctx, c.image);
    const w = src ? 980 : M.w - 160;
    const boxes: Box[] = [];
    const parts: Box[] = [];
    const label = read.str(c, 'label');
    if (label) parts.push(eyebrow(ctx, 'label', label, M.x, 0, w, ctx.theme.colors.accent, 'label'));
    parts.push(text(ctx, { id: 'term', text: read.str(c, 'term') || ' ', x: M.x, y: 0, w, h: 330, role: 'display', max: 150, min: 76, maxLines: 2, hug: true, bind: 'term' }));
    const def = read.str(c, 'definition');
    if (def) parts.push(text(ctx, { id: 'definition', text: def, x: M.x, y: 0, w, h: 300, max: 50, min: 32, hug: true, bind: 'definition' }));
    const ex = read.str(c, 'example');
    let exBlock: Box[] = [];
    if (ex) {
      const pad = 40;
      const tb = text(ctx, { id: 'example', text: ex, x: M.x + pad + 14, y: 0, w: w - pad * 2 - 14, h: 260, max: 40, min: 28, italic: true, hug: true, color: ctx.theme.colors.ink, bind: 'example' });
      const ch = tb.h + pad * 2;
      exBlock = [card(ctx, 'example-card', M.x, 0, w, ch, { stroke: undefined, strokeWidth: 0 }), shape({ id: 'example-bar', shape: 'rect', x: M.x, y: 0, w: 12, h: ch, fill: ctx.theme.colors.accent, radius: 0 }), tb];
    }
    const gaps = [26, 30, 48];
    const heights = parts.map((p) => p.h);
    const exH = exBlock.length ? (exBlock[0] as Box).h : 0;
    const blockH = heights.reduce((a, b) => a + b, 0) + gaps.slice(0, parts.length - 1).reduce((a, b) => a + b, 0) + (exH ? 48 + exH : 0);
    let y = Math.max(M.top, (CANVAS_H - blockH) / 2 - 10);
    parts.forEach((p, i) => { p.y = y; boxes.push(p); y += p.h + (gaps[i] ?? 30); });
    if (exBlock.length) {
      y += 48 - (gaps[parts.length - 1] ?? 30);
      exBlock.forEach((b) => { b.y = b.id === 'example' ? y + 40 : y; });
      boxes.push(...exBlock);
    }
    if (src) boxes.push(...imageOrPlaceholder(ctx, 'image', src, M.x + w + 80, M.top + 40, M.right - (M.x + w + 80), M.bottom - M.top - 80));
    return { boxes };
  },
};

const stats: SlideKindDefinition<C> = {
  kind: 'stats', label: 'Big numbers', description: 'One to four figures that tell the story.', icon: 'chart-no-axes-column', group: 'Data',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'stats', label: 'Figures', type: 'objects', itemLabel: 'Figure', max: 4, min: 1, fields: [
      { key: 'value', label: 'Number', type: 'text', placeholder: '71%' },
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'text' },
    ] },
  ],
  create: () => ({ title: 'By the numbers', stats: [{ value: '71%', label: 'of Earth is water', detail: '' }, { value: '3%', label: 'of that is fresh', detail: '' }] }),
  heading: (c) => read.str(c, 'title') || 'Big numbers',
  text: (c) => [read.str(c, 'title'), ...read.objects(c, 'stats').flatMap((s) => [String(s.value ?? ''), String(s.label ?? ''), String(s.detail ?? '')])].filter(Boolean),
  layout(c, ctx) {
    const items = read.objects<Record<string, unknown>>(c, 'stats').slice(0, 4);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    if (!items.length) return { boxes };
    const n = items.length;
    const gap = 64;
    const colW = (M.w - gap * (n - 1)) / n;
    const top = Math.max(bottom + 20, 380);
    items.forEach((s, i) => {
      const x = M.x + i * (colW + gap);
      if (i > 0) boxes.push(shape({ id: `sep-${i}`, shape: 'rect', x: x - gap / 2 - 1, y: top + 10, w: 3, h: 360, fill: ctx.theme.colors.line }));
      const v = text(ctx, { id: `v${i}`, text: String(s.value ?? ''), x, y: top, w: colW, h: 200, role: 'display', max: n > 2 ? 140 : 170, min: 72, maxLines: 1, hug: true, color: ctx.theme.colors.accent, bind: `stats.${i}.value` });
      boxes.push(v);
      let y = v.y + v.h + 18;
      const l = text(ctx, { id: `l${i}`, text: String(s.label ?? ''), x, y, w: colW, h: 130, max: 42, min: 28, weight: 650, maxLines: 2, hug: true, bind: `stats.${i}.label` });
      boxes.push(l);
      y += l.h + 14;
      const d = String(s.detail ?? '');
      if (d) boxes.push(text(ctx, { id: `d${i}`, text: d, x, y, w: colW, h: 150, max: 32, min: 24, color: ctx.theme.colors.muted, maxLines: 3, hug: true, bind: `stats.${i}.detail` }));
    });
    return { boxes };
  },
};

const steps: SlideKindDefinition<C> = {
  kind: 'steps', label: 'Steps', description: 'A process or a timeline, left to right.', icon: 'milestone', group: 'Explain',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'steps', label: 'Steps', type: 'objects', itemLabel: 'Step', max: 6, min: 2, fields: [
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'textarea', rows: 2 },
    ] },
    { key: 'reveal', label: 'Reveal steps one at a time', type: 'toggle' },
  ],
  create: () => ({ title: 'How it works', steps: [{ label: 'Observe', detail: '' }, { label: 'Ask', detail: '' }, { label: 'Test', detail: '' }], reveal: true }),
  heading: (c) => read.str(c, 'title') || 'Steps',
  text: (c) => [read.str(c, 'title'), ...read.objects(c, 'steps').flatMap((s) => [String(s.label ?? ''), String(s.detail ?? '')])].filter(Boolean),
  layout(c, ctx) {
    const items = read.objects<Record<string, unknown>>(c, 'steps').slice(0, 6);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    if (!items.length) return { boxes };
    const n = items.length;
    const colW = M.w / n;
    const d = sz(ctx, n > 4 ? 76 : 92);
    const trackY = Math.max(bottom + 40, 360) + d / 2;
    const reveal = read.bool(c, 'reveal');
    boxes.push(shape({ id: 'track', shape: 'rect', x: M.x + colW / 2, y: trackY - 3, w: colW * (n - 1), h: 6, fill: ctx.theme.colors.line, radius: 3 }));
    items.forEach((s, i) => {
      const cx = M.x + colW * i + colW / 2;
      const step = reveal ? i + 1 : undefined;
      boxes.push(shape({ id: `node-${i}`, shape: 'ellipse', x: cx - d / 2, y: trackY - d / 2, w: d, h: d, fill: ctx.theme.colors.accent, step }));
      boxes.push({ type: 'text', id: `num-${i}`, x: cx - d / 2, y: trackY - d / 2, w: d, h: d, text: String(i + 1), step,
        style: { font: 'display', size: Math.round(d * 0.46), weight: 700, color: ctx.theme.colors.onAccent, align: 'center', valign: 'middle', lineHeight: 1 } });
      const tw = colW - 36;
      const l = text(ctx, { id: `label-${i}`, text: String(s.label ?? ''), x: cx - tw / 2, y: trackY + d / 2 + 34, w: tw, h: 140, role: 'display', max: 46, min: 30, maxLines: 2, hug: true, align: 'center', step, bind: `steps.${i}.label` });
      boxes.push(l);
      const detail = String(s.detail ?? '');
      if (detail) boxes.push(text(ctx, { id: `detail-${i}`, text: detail, x: cx - tw / 2, y: l.y + l.h + 14, w: tw, h: M.bottom - (l.y + l.h + 14), max: 32, min: 22, align: 'center', color: ctx.theme.colors.muted, hug: true, step, bind: `steps.${i}.detail` }));
    });
    return { boxes };
  },
};

// ─── Check ────────────────────────────────────────────────────────────

const LETTERS = 'ABCDEF';

const question: SlideKindDefinition<C> = {
  kind: 'question', label: 'Question or poll', description: 'Ask the audience a question or run a quick poll. Choices are optional; the answer appears on click.', icon: 'circle-help', group: 'Engage',
  fields: [
    { key: 'question', label: 'Question', type: 'textarea', rows: 3 },
    { key: 'options', label: 'Choices', type: 'list', itemLabel: 'Choice', max: 6, correctKey: 'correct', help: 'Leave empty for an open question. Mark the correct choice.' },
    { key: 'answer', label: 'Answer or explanation', type: 'textarea', rows: 2, help: 'Shown when you click.' },
  ],
  create: () => ({ question: 'Which of these is a renewable source of energy?', options: ['Coal', 'Wind', 'Natural gas', 'Oil'], correct: 1, answer: 'Wind is renewed by the weather; the others take millions of years to form.' }),
  heading: (c) => read.str(c, 'question').slice(0, 70) || 'Question',
  text: (c) => [read.str(c, 'question'), ...read.list(c, 'options'), read.str(c, 'answer')].filter(Boolean),
  layout(c, ctx) {
    const boxes: Box[] = [];
    const options = read.list(c, 'options').slice(0, 6);
    const correct = read.num(c, 'correct');
    const answer = read.str(c, 'answer');
    const eb = eyebrow(ctx, 'eyebrow', 'Question', M.x, M.top, 600);
    boxes.push(eb);
    const q = text(ctx, { id: 'question', text: read.str(c, 'question') || ' ', x: M.x, y: eb.y + eb.h + 20, w: M.w - 120, h: options.length ? 260 : 420, role: 'display', max: 72, min: 44, hug: true, bind: 'question' });
    boxes.push(q);
    let y = q.y + q.h + sz(ctx, 52);
    const answerH = answer ? Math.min(220, heightAt(ctx, answer, sz(ctx, 34), M.w - 140) + 72) : 0;
    const good = ctx.theme.colors.good;
    if (options.length) {
      const twoCols = options.length >= 4 && options.every((o) => o.length <= 48);
      const cols = twoCols ? 2 : 1;
      const rows = Math.ceil(options.length / cols);
      const gapX = 40;
      const gapY = 28;
      const areaH = M.bottom - y - (answerH ? answerH + 32 : 0);
      const cardH = Math.min(sz(ctx, 132), (areaH - gapY * (rows - 1)) / rows);
      const cardW = (M.w - gapX * (cols - 1)) / cols;
      options.forEach((opt, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = M.x + col * (cardW + gapX);
        const cy = y + row * (cardH + gapY);
        const isCorrect = i === correct;
        boxes.push(card(ctx, `opt-${i}`, x, cy, cardW, cardH));
        const d = Math.min(cardH - 36, sz(ctx, 64));
        boxes.push(shape({ id: `opt-${i}-badge`, shape: 'ellipse', x: x + 28, y: cy + (cardH - d) / 2, w: d, h: d, fill: ctx.theme.colors.accent2 }));
        boxes.push({ type: 'text', id: `opt-${i}-letter`, x: x + 28, y: cy + (cardH - d) / 2, w: d, h: d, text: LETTERS[i] ?? '?',
          style: { font: 'body', size: Math.round(d * 0.48), weight: 750, color: ctx.theme.colors.ink, align: 'center', valign: 'middle', lineHeight: 1 } });
        boxes.push(text(ctx, { id: `opt-${i}-text`, text: opt, x: x + 28 + d + 28, y: cy + 10, w: cardW - d - 96, h: cardH - 20, max: 42, min: 26, valign: 'middle', bind: `options.${i}` }));
        if (correct >= 0) {
          if (isCorrect) {
            boxes.push(shape({ id: `opt-${i}-ring`, shape: 'rect', x: x - 4, y: cy - 4, w: cardW + 8, h: cardH + 8, stroke: good, strokeWidth: 8, radius: ctx.theme.radius + 4, step: 1, reveal: 'answer' }));
            boxes.push(shape({ id: `opt-${i}-ok`, shape: 'ellipse', x: x + 28, y: cy + (cardH - d) / 2, w: d, h: d, fill: good, step: 1, reveal: 'answer' }));
            boxes.push({ type: 'text', id: `opt-${i}-tick`, x: x + 28, y: cy + (cardH - d) / 2, w: d, h: d, text: '✓', step: 1, reveal: 'answer',
              style: { font: 'body', size: Math.round(d * 0.55), weight: 800, color: '#FFFFFF', align: 'center', valign: 'middle', lineHeight: 1 } });
          } else {
            boxes.push(shape({ id: `opt-${i}-dim`, shape: 'rect', x, y: cy, w: cardW, h: cardH, fill: ctx.theme.colors.bg, opacity: 0.6, radius: ctx.theme.radius, step: 1, reveal: 'answer' }));
          }
        }
      });
      y += rows * cardH + (rows - 1) * gapY + 32;
    }
    if (answer) {
      const ay = options.length ? M.bottom - answerH : Math.max(y, M.bottom - answerH - 40);
      boxes.push(shape({ id: 'answer-card', shape: 'rect', x: M.x, y: ay, w: M.w, h: answerH, fill: ctx.theme.colors.surface, stroke: good, strokeWidth: 3, radius: ctx.theme.radius, step: 1, reveal: 'answer' }));
      boxes.push(text(ctx, { id: 'answer', text: answer, x: M.x + 48, y: ay + 24, w: M.w - 96, h: answerH - 48, max: 38, min: 24, valign: 'middle', step: 1, reveal: 'answer', bind: 'answer' }));
    }
    return { boxes };
  },
};

const recall: SlideKindDefinition<C> = {
  kind: 'recall', label: 'Quick recall', description: 'Several prompts; each answer appears on its own click.', icon: 'layout-grid', group: 'Engage',
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'cards', label: 'Prompts', type: 'objects', itemLabel: 'Prompt', max: 6, min: 1, fields: [
      { key: 'prompt', label: 'Prompt', type: 'textarea', rows: 2 },
      { key: 'answer', label: 'Answer', type: 'text' },
    ] },
  ],
  create: () => ({ title: 'Quick recall', cards: [{ prompt: 'First question', answer: 'Answer' }, { prompt: 'Second question', answer: 'Answer' }, { prompt: 'Third question', answer: 'Answer' }] }),
  heading: (c) => read.str(c, 'title') || 'Quick recall',
  text: (c) => [read.str(c, 'title'), ...read.objects(c, 'cards').flatMap((k) => [String(k.prompt ?? ''), String(k.answer ?? '')])].filter(Boolean),
  layout(c, ctx) {
    const items = read.objects<Record<string, unknown>>(c, 'cards').slice(0, 6);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title') || 'Quick recall');
    const boxes: Box[] = [box];
    const n = items.length;
    if (!n) return { boxes };
    const cols = n <= 3 ? n : n === 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const gap = 36;
    const cardW = (M.w - gap * (cols - 1)) / cols;
    const cardH = Math.min(520, (M.bottom - bottom - gap * (rows - 1)) / rows);
    const pad = 40;
    items.forEach((k, i) => {
      const x = M.x + (i % cols) * (cardW + gap);
      const y = bottom + Math.floor(i / cols) * (cardH + gap);
      boxes.push(card(ctx, `card-${i}`, x, y, cardW, cardH));
      boxes.push(text(ctx, { id: `num-${i}`, text: String(i + 1).padStart(2, '0'), x: x + pad, y: y + pad - 8, w: 120, h: 40, max: 26, min: 22, weight: 750, color: ctx.theme.colors.accent, scaled: false, tracking: 0.08 }));
      const answerH = Math.min(cardH * 0.32, 140);
      boxes.push(text(ctx, { id: `prompt-${i}`, text: String(k.prompt ?? ''), x: x + pad, y: y + pad + 44, w: cardW - pad * 2, h: cardH - pad * 2 - 44 - answerH - 20, max: 42, min: 26, weight: 600, bind: `cards.${i}.prompt` }));
      boxes.push(shape({ id: `rule-${i}`, shape: 'line', x: x + pad, y: y + cardH - pad - answerH, w: cardW - pad * 2, h: 0, stroke: ctx.theme.colors.line, strokeWidth: 3, dash: true }));
      boxes.push(text(ctx, { id: `answer-${i}`, text: String(k.answer ?? ''), x: x + pad, y: y + cardH - pad - answerH + 16, w: cardW - pad * 2, h: answerH - 16, max: 40, min: 24, weight: 700, color: ctx.theme.colors.good, valign: 'middle', step: i + 1, reveal: 'answer', bind: `cards.${i}.answer` }));
    });
    return { boxes };
  },
};

// ─── Close ────────────────────────────────────────────────────────────

const summary: SlideKindDefinition<C> = {
  kind: 'summary', label: 'Takeaways', description: 'The points everyone should leave with.', icon: 'list-checks', group: 'Close',
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'points', label: 'Takeaways', type: 'list', itemLabel: 'Takeaway', max: 6 },
  ],
  create: () => ({ title: 'Key takeaways', points: ['First takeaway', 'Second takeaway', 'Third takeaway'] }),
  heading: (c) => read.str(c, 'title') || 'Takeaways',
  text: (c) => [read.str(c, 'title'), ...read.list(c, 'points')],
  layout(c, ctx) {
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title') || 'Key takeaways');
    return { boxes: [box, ...list(ctx, read.list(c, 'points'), { x: M.x, y: bottom, w: M.w - 160, h: M.bottom - bottom - 20, marker: 'check', bindKey: 'points', vcenter: true, markerColor: ctx.theme.colors.good })] };
  },
};

const closing: SlideKindDefinition<C> = {
  kind: 'closing', label: 'Closing', description: 'Closing questions for the room, and a closing line.', icon: 'door-open', group: 'Close',
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'prompts', label: 'Questions', type: 'list', itemLabel: 'Question', max: 4 },
    { key: 'closing', label: 'Closing line', type: 'text', placeholder: 'Questions?' },
  ],
  create: () => ({ title: 'Before we close', prompts: ['What stood out for you?', 'What is still unclear?'], closing: 'Thank you!' }),
  heading: (c) => read.str(c, 'title') || 'Closing',
  text: (c) => [read.str(c, 'title'), ...read.list(c, 'prompts'), read.str(c, 'closing')].filter(Boolean),
  layout(c, ctx) {
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title') || 'Before we close');
    const closingLine = read.str(c, 'closing');
    const reserve = closingLine ? 150 : 0;
    const boxes: Box[] = [box, ...list(ctx, read.list(c, 'prompts'), { x: M.x, y: bottom, w: M.w - 160, h: M.bottom - bottom - reserve, marker: 'number', bindKey: 'prompts', vcenter: true })];
    if (closingLine) {
      boxes.push(shape({ id: 'rule', shape: 'rect', x: M.x, y: M.bottom - 118, w: 96, h: 8, radius: 4, fill: ctx.theme.colors.accent }));
      boxes.push(text(ctx, { id: 'closing', text: closingLine, x: M.x, y: M.bottom - 90, w: M.w, h: 96, role: 'display', max: 64, min: 40, maxLines: 1, bind: 'closing' }));
    }
    return { boxes };
  },
};

export const CORE_KINDS: AnyKind[] = [title, section, agenda, bullets, compare, image, quote, term, stats, steps, question, recall, summary, closing];

let registered = false;
export function registerCoreKinds() {
  if (registered) return;
  registered = true;
  [...CORE_KINDS, ...DATA_KINDS, ...VISUAL_KINDS].forEach(registerKind);
}

/** Weight of the body face, for renderers that need it. */
export const bodyWeight = (ctx: LayoutContext) => fontWeight(ctx.theme, 'body');

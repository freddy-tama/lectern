// Visual slide types: timeline, statement, gallery, people, diagram, code.
// Registered with the core kinds.

import { type Box, type TextBox, CANVAS_H, CANVAS_W } from '../engine/boxes';
import { fontWeight } from '../engine/themes';
import { M, type LayoutContext, card, imageSrc, read, shape, slideTitle, sz, text } from './kit';
import type { AnyKind, SlideKindDefinition } from './types';

type C = Record<string, unknown>;
type Item = Record<string, unknown>;

/** Items with at least one filled field. The original index is kept so `bind` still points at the right row. */
function items(c: C, key: string, max: number) {
  return read.objects<Item>(c, key)
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => Object.values(o).some((v) => String(v ?? '').trim()))
    .slice(0, max);
}

function field(o: Item, key: string) {
  return String(o[key] ?? '').trim();
}

function allText(c: C, key: string, subkeys: string[]) {
  return read.objects<Item>(c, key).flatMap((o) => subkeys.map((k) => field(o, k)));
}

function imageOrPlaceholder(ctx: LayoutContext, id: string, src: string, x: number, y: number, w: number, h: number, bind: string, radius = ctx.theme.radius): Box[] {
  if (src) return [{ type: 'image', id, src, x, y, w, h, fit: 'cover', radius, bind }];
  if (ctx.mode !== 'edit') return [];
  return [
    shape({ id: `${id}-ph`, shape: 'rect', x, y, w, h, fill: ctx.theme.colors.surface, stroke: ctx.theme.colors.line, strokeWidth: 3, radius, dash: true, bind }),
    text(ctx, { id: `${id}-ph-t`, text: 'Add an image', x, y: y + h / 2 - 30, w, h: 60, max: 30, min: 24, color: ctx.theme.colors.muted, align: 'center', scaled: false, bind }),
  ];
}

/** Centred label inside a shape, for numbers and initials. */
function badgeText(id: string, value: string, x: number, y: number, d: number, color: string, font: 'display' | 'body', size: number, extra: Partial<TextBox> = {}): TextBox {
  return {
    type: 'text', id, x, y, w: d, h: d, text: value,
    style: { font, size, weight: 700, color, align: 'center', valign: 'middle', lineHeight: 1 },
    ...extra,
  };
}

// ─── Timeline ─────────────────────────────────────────────────────────

const timeline: SlideKindDefinition<C> = {
  kind: 'timeline', label: 'Timeline', description: 'Milestones along a dated axis: a roadmap, a history or a project plan.', icon: 'waypoints', group: 'Explain',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'milestones', label: 'Milestones', type: 'objects', itemLabel: 'Milestone', max: 6, min: 2, help: 'Two to six, in order from left to right.', fields: [
      { key: 'date', label: 'Date', type: 'text', placeholder: 'Mar 2026, Q3, Day 1' },
      { key: 'title', label: 'Milestone', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'textarea', rows: 2, help: 'Optional. Keep it to a short phrase.' },
    ] },
    { key: 'reveal', label: 'Reveal milestones one at a time', type: 'toggle' },
  ],
  create: () => ({
    title: 'Product roadmap',
    milestones: [
      { date: 'Jan', title: 'Prototype', detail: 'Tested with users' },
      { date: 'Apr', title: 'Beta', detail: 'Invite-only launch' },
      { date: 'Jul', title: 'Launch', detail: 'Open to everyone' },
      { date: 'Oct', title: 'Scale', detail: 'Three new markets' },
    ],
    reveal: false,
  }),
  heading: (c) => read.str(c, 'title') || 'Timeline',
  text: (c) => [read.str(c, 'title'), ...allText(c, 'milestones', ['date', 'title', 'detail'])].filter(Boolean),
  layout(c, ctx) {
    const list = items(c, 'milestones', 6);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    if (!list.length) return { boxes };
    const colors = ctx.theme.colors;
    const n = list.length;
    const reveal = read.bool(c, 'reveal');
    const colW = M.w / n;
    const tw = colW - 28;
    const d = sz(ctx, n > 4 ? 34 : 40);
    const dateH = Math.ceil(sz(ctx, 54) * 1.1);
    const axisY = Math.max(bottom + dateH + 70, bottom + (M.bottom - bottom) * 0.38);
    boxes.push(shape({ id: 'axis', shape: 'rect', x: M.x, y: axisY - 3, w: M.w, h: 6, fill: colors.line, radius: 3 }));
    list.forEach(({ o, i }, k) => {
      const cx = M.x + colW * k + colW / 2;
      const step = reveal ? k + 1 : undefined;
      const date = field(o, 'date');
      if (date) boxes.push(text(ctx, { id: `date-${k}`, text: date, x: cx - tw / 2, y: axisY - d / 2 - 22 - dateH, w: tw, h: dateH, role: 'display', max: 54, min: 30, maxLines: 1, color: colors.accent, align: 'center', valign: 'bottom', step, bind: `milestones.${i}.date` }));
      boxes.push(shape({ id: `marker-${k}`, shape: 'ellipse', x: cx - d / 2, y: axisY - d / 2, w: d, h: d, fill: colors.accent, stroke: colors.bg, strokeWidth: 8, step }));
      const title = field(o, 'title');
      let y = axisY + d / 2 + 30;
      if (title) {
        const t = text(ctx, { id: `title-${k}`, text: title, x: cx - tw / 2, y, w: tw, h: 150, role: 'display', max: 40, min: 26, maxLines: 3, hug: true, align: 'center', step, bind: `milestones.${i}.title` });
        boxes.push(t);
        y += t.h + 14;
      }
      const detail = field(o, 'detail');
      if (detail) boxes.push(text(ctx, { id: `detail-${k}`, text: detail, x: cx - tw / 2, y, w: tw, h: M.bottom - y, max: 30, min: 22, color: colors.muted, align: 'center', hug: true, step, bind: `milestones.${i}.detail` }));
    });
    return { boxes };
  },
};

// ─── Statement ────────────────────────────────────────────────────────

const statement: SlideKindDefinition<C> = {
  kind: 'statement', label: 'Statement', description: 'One big message, with a small label above and a supporting line below.', icon: 'megaphone', group: 'Explain',
  variants: [{ id: 'plain', label: 'Plain' }, { id: 'bold', label: 'Bold colour' }],
  autoVariant: (_c, auto) => (auto.previous === 'bold' ? 'plain' : 'bold'),
  fields: [
    { key: 'kicker', label: 'Label above', type: 'text', placeholder: 'Our mission', help: 'Optional. A few words in small capitals.' },
    { key: 'statement', label: 'Message', type: 'textarea', rows: 3, help: 'Shorter is stronger. One sentence works best.' },
    { key: 'support', label: 'Supporting line', type: 'textarea', rows: 2, help: 'Optional. One line of context.' },
  ],
  create: () => ({ kicker: 'Our mission', statement: 'Make hard things simple.', support: 'Clear tools for small teams.' }),
  heading: (c) => read.str(c, 'statement').slice(0, 70) || 'Statement',
  text: (c) => [read.str(c, 'kicker'), read.str(c, 'statement'), read.str(c, 'support')].filter(Boolean),
  layout(c, ctx, variant) {
    const colors = ctx.theme.colors;
    const bold = variant === 'bold';
    const ink = bold ? colors.onAccent : colors.ink;
    const w = M.w - 160;
    const parts: TextBox[] = [];
    const gaps: number[] = [];
    const kicker = read.str(c, 'kicker');
    if (kicker) {
      const k = text(ctx, { id: 'kicker', text: kicker, x: M.x, y: 0, w, h: sz(ctx, 34) * 1.4, max: 30, min: 22, weight: 700, color: bold ? ink : colors.accent, tracking: 0.12, uppercase: true, hug: true, maxLines: 1, bind: 'kicker' });
      if (bold) k.opacity = 0.85;
      parts.push(k);
      gaps.push(sz(ctx, 34));
    }
    parts.push(text(ctx, { id: 'statement', text: read.str(c, 'statement') || ' ', x: M.x, y: 0, w, h: 620, role: 'display', max: 128, min: 60, maxLines: 6, lh: 1.12, hug: true, color: ink, bind: 'statement' }));
    const support = read.str(c, 'support');
    if (support) {
      gaps.push(sz(ctx, 44));
      const s = text(ctx, { id: 'support', text: support, x: M.x, y: 0, w: Math.min(w, 1300), h: 200, max: 46, min: 30, color: bold ? ink : colors.muted, hug: true, maxLines: 3, bind: 'support' });
      if (bold) s.opacity = 0.88;
      parts.push(s);
    }
    const blockH = parts.reduce((sum, p) => sum + p.h, 0) + gaps.reduce((a, b) => a + b, 0);
    let y = Math.max(M.top, (CANVAS_H - blockH) / 2);
    parts.forEach((p, i) => { p.y = y; y += p.h + (gaps[i] ?? 0); });
    return { boxes: parts, background: bold ? colors.accent : undefined, frame: bold ? 'bare' : 'content' };
  },
};

// ─── Gallery ──────────────────────────────────────────────────────────

interface Cell { x: number; y: number; w: number; h: number }

function galleryCells(n: number, strip: boolean, a: Cell, gap: number, capH: number): Cell[] {
  if (strip || n === 1) {
    const w = (a.w - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({ x: a.x + i * (w + gap), y: a.y, w, h: a.h }));
  }
  if (n === 3) {
    const half = (a.w - gap) / 2;
    const h = (a.h - gap) / 2;
    return [
      { x: a.x, y: a.y, w: half, h: a.h },
      { x: a.x + half + gap, y: a.y, w: half, h },
      { x: a.x + half + gap, y: a.y + h + gap, w: half, h },
    ];
  }
  const cols = 2;
  const w = (a.w - gap * (cols - 1)) / cols;
  const rows = Math.ceil(n / cols);
  let h = (a.h - gap * (rows - 1)) / rows;
  // Two pictures side by side stay landscape instead of stretching to full height.
  if (rows === 1) h = Math.min(h, Math.round((w * 3) / 4) + capH);
  const top = a.y + (a.h - (h * rows + gap * (rows - 1))) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: a.x + (i % cols) * (w + gap), y: top + Math.floor(i / cols) * (h + gap), w, h }));
}

const gallery: SlideKindDefinition<C> = {
  kind: 'gallery', label: 'Gallery', description: 'Two to four images with optional captions, as a grid or a strip.', icon: 'images', group: 'Visual',
  variants: [{ id: 'grid', label: 'Grid' }, { id: 'strip', label: 'Strip' }],
  autoVariant: (c) => (items(c, 'images', 4).length === 2 ? 'strip' : 'grid'),
  fields: [
    { key: 'title', label: 'Title', type: 'text', help: 'Optional.' },
    { key: 'images', label: 'Images', type: 'objects', itemLabel: 'Image', max: 4, min: 2, help: 'Two to four images.', fields: [
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'caption', label: 'Caption', type: 'text', help: 'Optional.' },
    ] },
  ],
  create: () => ({
    title: 'Launch week',
    images: [
      { image: '', caption: 'Keynote stage' },
      { image: '', caption: 'Demo booth' },
      { image: '', caption: 'Team dinner' },
    ],
  }),
  heading: (c) => read.str(c, 'title') || allText(c, 'images', ['caption']).find(Boolean) || 'Gallery',
  text: (c) => [read.str(c, 'title'), ...allText(c, 'images', ['caption'])].filter(Boolean),
  layout(c, ctx, variant) {
    const list = read.objects<Item>(c, 'images').map((o, i) => ({ o, i })).filter(({ o }) => field(o, 'image') || field(o, 'caption')).slice(0, 4);
    const title = read.str(c, 'title');
    const boxes: Box[] = [];
    let top = M.top;
    if (title) {
      const t = slideTitle(ctx, title);
      boxes.push(t.box);
      top = t.bottom - sz(ctx, 10);
    }
    if (!list.length) return { boxes };
    const colors = ctx.theme.colors;
    const hasCaption = list.some(({ o }) => field(o, 'caption'));
    const capSize = sz(ctx, 28);
    const capH = hasCaption ? Math.ceil(capSize * 1.3 * 2) + 14 : 0;
    const cells = galleryCells(list.length, variant === 'strip', { x: M.x, y: top, w: M.w, h: M.bottom - top }, variant === 'strip' ? 20 : 32, capH);
    list.forEach(({ o, i }, k) => {
      const cell = cells[k]!;
      const imgH = cell.h - capH;
      boxes.push(...imageOrPlaceholder(ctx, `image-${k}`, imageSrc(ctx, o.image), cell.x, cell.y, cell.w, imgH, `images.${i}.image`));
      const caption = field(o, 'caption');
      if (caption) boxes.push(text(ctx, { id: `caption-${k}`, text: caption, x: cell.x, y: cell.y + imgH + 14, w: cell.w, h: capH - 14, max: 28, min: 22, maxLines: 2, color: colors.muted, bind: `images.${i}.caption` }));
    });
    return { boxes };
  },
};

// ─── People ───────────────────────────────────────────────────────────

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = (w: string) => Array.from(w)[0] ?? '';
  if (words.length > 1) return (first(words[0]!) + first(words[words.length - 1]!)).toUpperCase();
  const chars = Array.from(words[0]!);
  return /[\u2E80-\uA4CF]/.test(chars[0] ?? '') ? chars[0]! : chars.slice(0, 2).join('').toUpperCase();
}

const people: SlideKindDefinition<C> = {
  kind: 'people', label: 'People', description: 'Round photos with names and roles: a team slide or a speaker introduction.', icon: 'users', group: 'Visual',
  fields: [
    { key: 'title', label: 'Title', type: 'text', help: 'Optional.' },
    { key: 'people', label: 'People', type: 'objects', itemLabel: 'Person', max: 6, min: 1, help: 'One to six. Without a photo, the initials are shown.', fields: [
      { key: 'photo', label: 'Photo', type: 'image' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'role', label: 'Role', type: 'text', placeholder: 'Head of design' },
    ] },
  ],
  create: () => ({
    title: 'Meet the team',
    people: [
      { photo: '', name: 'Maya Chen', role: 'Product lead' },
      { photo: '', name: 'Tom Alvarez', role: 'Engineering' },
      { photo: '', name: 'Priya Nair', role: 'Design' },
      { photo: '', name: 'Sam Okafor', role: 'Research' },
    ],
  }),
  heading: (c) => read.str(c, 'title') || allText(c, 'people', ['name']).find(Boolean) || 'People',
  text: (c) => [read.str(c, 'title'), ...allText(c, 'people', ['name', 'role'])].filter(Boolean),
  layout(c, ctx) {
    const list = items(c, 'people', 6);
    const title = read.str(c, 'title');
    const colors = ctx.theme.colors;
    const boxes: Box[] = [];
    let top = M.top;
    if (title) {
      const t = slideTitle(ctx, title);
      boxes.push(t.box);
      top = t.bottom;
    }
    if (!list.length) return { boxes };
    const n = list.length;
    const areaH = M.bottom - top;

    const photo = (k: number, i: number, o: Item, x: number, y: number, d: number): Box[] => {
      const src = imageSrc(ctx, o.photo);
      if (src) return [{ type: 'image', id: `photo-${k}`, src, x, y, w: d, h: d, fit: 'cover', radius: d / 2, bind: `people.${i}.photo` }];
      const letters = initials(field(o, 'name')) || (ctx.mode === 'edit' ? '?' : '');
      return [
        shape({ id: `photo-${k}`, shape: 'ellipse', x, y, w: d, h: d, fill: colors.accent2, bind: `people.${i}.photo` }),
        ...(letters ? [badgeText(`initials-${k}`, letters, x, y, d, colors.ink, 'display', Math.round(d * 0.38), { bind: `people.${i}.photo` })] : []),
      ];
    };

    if (n === 1) {
      const { o, i } = list[0]!;
      const d = Math.round(Math.min(areaH * 0.82, 460));
      const tx = M.x + d + 90;
      const tw = M.right - tx - 40;
      const name = field(o, 'name') ? text(ctx, { id: 'name-0', text: field(o, 'name'), x: tx, y: 0, w: tw, h: 300, role: 'display', max: 88, min: 48, maxLines: 2, hug: true, bind: `people.${i}.name` }) : null;
      const role = field(o, 'role') ? text(ctx, { id: 'role-0', text: field(o, 'role'), x: tx, y: 0, w: tw, h: 200, max: 44, min: 28, color: colors.muted, maxLines: 2, hug: true, bind: `people.${i}.role` }) : null;
      const gap = name && role ? sz(ctx, 22) : 0;
      const textH = (name?.h ?? 0) + gap + (role?.h ?? 0);
      const py = top + (areaH - d) / 2;
      boxes.push(...photo(0, i, o, M.x, py, d));
      let y = py + (d - textH) / 2;
      if (name) { name.y = y; boxes.push(name); y += name.h + gap; }
      if (role) { role.y = y; boxes.push(role); }
      return { boxes };
    }

    const rows = n > 4 ? 2 : 1;
    const perRow = rows === 1 ? n : 3;
    const cellW = rows === 1 ? Math.min(M.w / n, 440) : M.w / 3;
    const tw = cellW - 28;
    const cards = list.map(({ o, i }, k) => {
      const name = field(o, 'name') ? text(ctx, { id: `name-${k}`, text: field(o, 'name'), x: 0, y: 0, w: tw, h: 160, role: 'display', max: 40, min: 28, maxLines: 2, hug: true, align: 'center', bind: `people.${i}.name` }) : null;
      const role = field(o, 'role') ? text(ctx, { id: `role-${k}`, text: field(o, 'role'), x: 0, y: 0, w: tw, h: 120, max: 30, min: 22, color: colors.muted, maxLines: 2, hug: true, align: 'center', bind: `people.${i}.role` }) : null;
      return { o, i, name, role };
    });
    const labelGap = sz(ctx, 24);
    const captionH = Math.max(...cards.map((p) => (p.name?.h ?? 0) + (p.name && p.role ? 8 : 0) + (p.role?.h ?? 0)));
    const rowGap = 36;
    const totalFor = (d: number) => rows * (d + labelGap + captionH) + (rows - 1) * rowGap;
    let d = Math.round(Math.min(cellW - (rows === 1 ? 60 : 100), rows === 1 ? 340 : 220, areaH * (rows === 1 ? 0.62 : 0.5)));
    while (d > 96 && totalFor(d) > areaH) d -= 8;
    if (totalFor(d) > areaH) ctx.warnings.push('Too much text for this many people. Shorten the names and roles, or split them over two slides.');
    const y0 = top + Math.max(0, (areaH - totalFor(d)) / 2);
    cards.forEach((p, k) => {
      const row = Math.floor(k / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      const rowW = inRow * cellW;
      const cx = M.x + (M.w - rowW) / 2 + (k % perRow) * cellW + cellW / 2;
      const y = y0 + row * (d + labelGap + captionH + rowGap);
      boxes.push(...photo(k, p.i, p.o, cx - d / 2, y, d));
      let ty = y + d + labelGap;
      if (p.name) { p.name.x = cx - tw / 2; p.name.y = ty; boxes.push(p.name); ty += p.name.h + 8; }
      if (p.role) { p.role.x = cx - tw / 2; p.role.y = ty; boxes.push(p.role); }
    });
    return { boxes };
  },
};

// ─── Diagram ──────────────────────────────────────────────────────────

const diagram: SlideKindDefinition<C> = {
  kind: 'diagram', label: 'Diagram', description: 'A cycle, a funnel or a 2 by 2 matrix built from your own labels.', icon: 'refresh-cw', group: 'Visual',
  variants: [{ id: 'cycle', label: 'Cycle' }, { id: 'funnel', label: 'Funnel' }, { id: 'matrix', label: '2 by 2 matrix' }],
  // Four items with both axes named are a matrix; otherwise the presenter's choice stands.
  autoVariant: (c) => (items(c, 'items', 6).length === 4 && read.str(c, 'xAxis').trim() && read.str(c, 'yAxis').trim() ? 'matrix' : undefined),
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'items', label: 'Items', type: 'objects', itemLabel: 'Item', max: 6, min: 2, help: 'A cycle takes three to six. A funnel reads top to bottom. A matrix uses the first four, top left to bottom right.', fields: [
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'text', help: 'Optional. A short phrase.' },
    ] },
    { key: 'xAxis', label: 'Matrix: horizontal axis', type: 'text', placeholder: 'Effort', help: 'Only used by the matrix layout.' },
    { key: 'yAxis', label: 'Matrix: vertical axis', type: 'text', placeholder: 'Impact', help: 'Only used by the matrix layout.' },
    { key: 'reveal', label: 'Reveal items one at a time', type: 'toggle' },
  ],
  create: () => ({
    title: 'How we ship',
    items: [
      { label: 'Plan', detail: 'Pick one goal' },
      { label: 'Build', detail: 'Small steps' },
      { label: 'Ship', detail: 'Release weekly' },
      { label: 'Learn', detail: 'Ask users' },
    ],
    xAxis: 'Effort',
    yAxis: 'Impact',
    reveal: false,
  }),
  heading: (c) => read.str(c, 'title') || 'Diagram',
  text: (c) => [read.str(c, 'title'), ...allText(c, 'items', ['label', 'detail']), read.str(c, 'xAxis'), read.str(c, 'yAxis')].filter(Boolean),
  layout(c, ctx, variant) {
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    const reveal = read.bool(c, 'reveal');
    if (variant === 'matrix') return { boxes: boxes.concat(matrix(c, ctx, bottom, reveal)) };
    const list = items(c, 'items', 6);
    if (!list.length) return { boxes };
    boxes.push(...(variant === 'funnel' ? funnel(ctx, list, bottom, reveal) : cycle(ctx, list, bottom, reveal)));
    return { boxes };
  },
};

type Entry = { o: Item; i: number };

function cycle(ctx: LayoutContext, list: Entry[], top: number, reveal: boolean): Box[] {
  const colors = ctx.theme.colors;
  const n = list.length;
  const boxes: Box[] = [];
  const hasDetail = list.some(({ o }) => field(o, 'detail'));
  const cardW = n >= 5 ? 400 : 460;
  const labelH = Math.ceil(sz(ctx, 40) * 1.1);
  const detailH = Math.ceil(sz(ctx, 26) * 1.3 * 2);
  const cardH = 26 + labelH + (hasDetail ? 8 + detailH : 0) + 26;
  const areaTop = top;
  const areaH = M.bottom - areaTop;
  const angles = list.map((_, k) => -Math.PI / 2 + (2 * Math.PI * k) / n);
  const ry = Math.min(430, (areaH - cardH) / 2);
  const rx = Math.min(620, (M.w - cardW) / 2);
  const cx = CANVAS_W / 2;
  const cy = areaTop + areaH / 2;
  boxes.push(shape({ id: 'ring', shape: 'ellipse', x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2, stroke: colors.accent, strokeWidth: 5, opacity: 0.35 }));
  const badge = Math.round(sz(ctx, 46));
  list.forEach(({ o, i }, k) => {
    const x = cx + rx * Math.cos(angles[k]!) - cardW / 2;
    const y = cy + ry * Math.sin(angles[k]!) - cardH / 2;
    const step = reveal ? k + 1 : undefined;
    boxes.push(card(ctx, `node-${k}`, x, y, cardW, cardH, { step }));
    boxes.push(shape({ id: `badge-${k}`, shape: 'ellipse', x: x - 14, y: y - 14, w: badge, h: badge, fill: colors.accent, step }));
    boxes.push(badgeText(`num-${k}`, String(k + 1), x - 14, y - 14, badge, colors.onAccent, 'body', Math.round(badge * 0.5), { step }));
    const label = field(o, 'label');
    const detail = field(o, 'detail');
    const tx = x + 28;
    const tw = cardW - 56;
    let ty = y + 26;
    if (label) boxes.push(text(ctx, { id: `label-${k}`, text: label, x: tx, y: ty, w: tw, h: labelH, role: 'display', max: 40, min: 26, maxLines: 1, align: 'center', valign: 'middle', step, bind: `items.${i}.label` }));
    ty += labelH + 8;
    if (detail) boxes.push(text(ctx, { id: `detail-${k}`, text: detail, x: tx, y: ty, w: tw, h: detailH, max: 26, min: 20, maxLines: 2, align: 'center', color: colors.muted, step, bind: `items.${i}.detail` }));
  });
  return boxes;
}

function funnel(ctx: LayoutContext, list: Entry[], top: number, reveal: boolean): Box[] {
  const colors = ctx.theme.colors;
  const n = list.length;
  const boxes: Box[] = [];
  const hasDetail = list.some(({ o }) => field(o, 'detail'));
  const gap = 14;
  const areaTop = top + 10;
  const areaH = M.bottom - areaTop;
  const barH = Math.floor(Math.min(sz(ctx, 112), (areaH - gap * (n - 1)) / n));
  const total = barH * n + gap * (n - 1);
  const y0 = areaTop + (areaH - total) / 2;
  const maxW = hasDetail ? 1000 : 1500;
  const minW = hasDetail ? 440 : 620;
  const cx = hasDetail ? M.x + maxW / 2 : CANVAS_W / 2;
  const detailX = M.x + maxW + 64;
  list.forEach(({ o, i }, k) => {
    const w = n === 1 ? maxW : maxW - ((maxW - minW) * k) / (n - 1);
    const y = y0 + k * (barH + gap);
    const step = reveal ? k + 1 : undefined;
    boxes.push(shape({ id: `bar-${k}`, shape: 'rect', x: cx - w / 2, y, w, h: barH, fill: colors.accent, radius: Math.min(ctx.theme.radius, barH / 2), step }));
    const label = field(o, 'label');
    if (label) boxes.push(text(ctx, { id: `label-${k}`, text: label, x: cx - w / 2 + 24, y, w: w - 48, h: barH, role: 'display', max: 42, min: 26, maxLines: 1, color: colors.onAccent, align: 'center', valign: 'middle', step, bind: `items.${i}.label` }));
    const detail = field(o, 'detail');
    if (detail) boxes.push(text(ctx, { id: `detail-${k}`, text: detail, x: detailX, y, w: M.right - detailX, h: barH, max: 32, min: 22, color: colors.muted, valign: 'middle', maxLines: 3, step, bind: `items.${i}.detail` }));
  });
  return boxes;
}

function matrix(c: C, ctx: LayoutContext, top: number, reveal: boolean): Box[] {
  const colors = ctx.theme.colors;
  const list = items(c, 'items', 4);
  const boxes: Box[] = [];
  const xAxis = read.str(c, 'xAxis').trim();
  const yAxis = read.str(c, 'yAxis').trim();
  const rowH = Math.ceil(sz(ctx, 30) * 1.4);
  const gridLeft = M.x + 30;
  const gridTop = top + (yAxis ? rowH + 10 : 4);
  const gridBottom = M.bottom - (xAxis ? rowH + 26 : 0);
  const gap = 24;
  const qw = (M.right - gridLeft - gap) / 2;
  const qh = (gridBottom - gridTop - gap) / 2;
  if (yAxis) boxes.push(text(ctx, { id: 'y-axis', text: `↑ ${yAxis}`, x: M.x, y: gridTop - rowH - 10, w: 900, h: rowH, max: 30, min: 22, weight: 700, color: colors.muted, maxLines: 1, valign: 'middle', bind: 'yAxis' }));
  boxes.push(shape({ id: 'axis-y', shape: 'rect', x: M.x, y: gridTop, w: 6, h: gridBottom - gridTop, fill: colors.accent, radius: 3 }));
  boxes.push(shape({ id: 'axis-x', shape: 'rect', x: gridLeft, y: gridBottom + 14, w: M.right - gridLeft, h: 6, fill: colors.accent, radius: 3 }));
  if (xAxis) boxes.push(text(ctx, { id: 'x-axis', text: `${xAxis} →`, x: M.right - 900, y: gridBottom + 28, w: 900, h: rowH, max: 30, min: 22, weight: 700, color: colors.muted, maxLines: 1, align: 'right', valign: 'middle', bind: 'xAxis' }));
  const pad = 32;
  const slots = [0, 1, 2, 3].map((slot) => ({ slot, entry: list[slot] ?? null, k: slot }));
  slots.forEach(({ slot, entry, k }) => {
    const x = gridLeft + (slot % 2) * (qw + gap);
    const y = gridTop + Math.floor(slot / 2) * (qh + gap);
    const step = reveal && entry ? k + 1 : undefined;
    boxes.push(card(ctx, `quad-${slot}`, x, y, qw, qh, { step }));
    if (!entry) return;
    boxes.push(shape({ id: `quad-${slot}-bar`, shape: 'rect', x: x + pad, y: y + pad, w: 56, h: 8, radius: 4, fill: colors.accent, step }));
    const label = field(entry.o, 'label');
    const detail = field(entry.o, 'detail');
    const labelH = Math.ceil(sz(ctx, 40) * 1.1);
    let ty = y + pad + 8 + 16;
    if (label) boxes.push(text(ctx, { id: `label-${slot}`, text: label, x: x + pad, y: ty, w: qw - pad * 2, h: labelH, role: 'display', max: 40, min: 26, maxLines: 1, valign: 'middle', step, bind: `items.${entry.i}.label` }));
    ty += labelH + 8;
    if (detail) boxes.push(text(ctx, { id: `detail-${slot}`, text: detail, x: x + pad, y: ty, w: qw - pad * 2, h: Math.max(40, y + qh - pad - ty), max: 30, min: 22, color: colors.muted, maxLines: 3, step, bind: `items.${entry.i}.detail` }));
  });
  return boxes;
}

// ─── Code ─────────────────────────────────────────────────────────────

const PANEL = { fill: '#121826', stroke: '#2A3348', ink: '#E8ECF4', muted: '#8E99B0', dots: ['#FF6B6B', '#F5C451', '#5BD18B'] };
const CODE_LH = 1.45;
/** Widest monospace glyph, in em, for the fallback stack (JetBrains Mono is 0.6). */
const MONO_EM = 0.62;

const code: SlideKindDefinition<C> = {
  kind: 'code', label: 'Code', description: 'A snippet on a dark panel, with indentation kept.', icon: 'code', group: 'Explain',
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'language', label: 'Language', type: 'text', placeholder: 'Python', help: 'Shown in the corner of the panel. Optional.' },
    { key: 'code', label: 'Code', type: 'textarea', rows: 10, help: 'Spaces and line breaks are kept. About 14 lines of 70 characters is the most that stays readable.' },
    { key: 'caption', label: 'Caption', type: 'text', help: 'Optional. What to notice.' },
  ],
  create: () => ({
    title: 'Add up a list',
    language: 'Python',
    code: ['def total(prices):', '    result = 0', '    for p in prices:', '        result += p', '    return result'].join('\n'),
    caption: 'Indentation marks the body.',
  }),
  heading: (c) => read.str(c, 'title') || 'Code',
  text: (c) => [read.str(c, 'title'), read.str(c, 'code'), read.str(c, 'caption')].filter(Boolean),
  layout(c, ctx) {
    const colors = ctx.theme.colors;
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    const source = read.str(c, 'code').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/\s+$/, '').replace(/^\n+/, '');
    const caption = read.str(c, 'caption');
    const cap = caption ? text(ctx, { id: 'caption', text: caption, x: M.x, y: 0, w: M.w, h: 100, max: 30, min: 22, color: colors.muted, hug: true, maxLines: 2, bind: 'caption' }) : null;
    const top = bottom - sz(ctx, 10);
    const panelMax = M.bottom - top - (cap ? cap.h + 24 : 0);
    const header = 72;
    const padX = 40;
    const padBottom = 36;
    const innerW = M.w - padX * 2;
    const innerMax = panelMax - header - 16 - padBottom;
    const lines = source.split('\n');
    const longest = Math.max(1, ...lines.map((l) => Array.from(l).length));
    const maxSize = sz(ctx, 40);
    let size = 22;
    let overflow = true;
    for (let s = maxSize; s >= 22; s -= 2) {
      if (longest <= Math.floor(innerW / (s * MONO_EM)) && lines.length * s * CODE_LH <= innerMax) { size = s; overflow = false; break; }
    }
    if (overflow && source) ctx.warnings.push('Text is too long to fit: this code snippet. Shorten it or split it over two slides.');
    const codeH = source ? (overflow ? innerMax : Math.ceil(lines.length * size * CODE_LH)) : 160;
    const panelH = Math.min(panelMax, Math.max(300, header + 16 + codeH + padBottom));
    boxes.push(shape({ id: 'panel', shape: 'rect', x: M.x, y: top, w: M.w, h: panelH, fill: PANEL.fill, stroke: PANEL.stroke, strokeWidth: 2, radius: Math.min(ctx.theme.radius, 28) }));
    PANEL.dots.forEach((fill, k) => boxes.push(shape({ id: `dot-${k}`, shape: 'ellipse', x: M.x + 32 + k * 30, y: top + header / 2 - 8, w: 16, h: 16, fill })));
    const language = read.str(c, 'language').trim();
    if (language) boxes.push(text(ctx, { id: 'language', text: language, x: M.right - 440, y: top, w: 408, h: header, role: 'mono', max: 24, min: 20, scaled: false, color: PANEL.muted, align: 'right', valign: 'middle', maxLines: 1, bind: 'language' }));
    boxes.push(shape({ id: 'panel-rule', shape: 'rect', x: M.x, y: top + header, w: M.w, h: 2, fill: PANEL.stroke }));
    const cy = top + header + 16;
    if (source) {
      boxes.push({
        type: 'text', id: 'code', x: M.x + padX, y: cy, w: innerW, h: codeH, text: source, bind: 'code', overflow,
        style: { font: 'mono', size, weight: fontWeight(ctx.theme, 'mono'), color: PANEL.ink, align: 'left', valign: 'top', lineHeight: CODE_LH },
      });
    } else if (ctx.mode === 'edit') {
      boxes.push({
        type: 'text', id: 'code-ph', x: M.x + padX, y: cy, w: innerW, h: 60, text: 'Paste your code here', bind: 'code',
        style: { font: 'mono', size: 28, weight: fontWeight(ctx.theme, 'mono'), color: PANEL.muted, align: 'left', valign: 'top', lineHeight: CODE_LH },
      });
    }
    if (cap) { cap.y = top + panelH + 24; boxes.push(cap); }
    return { boxes };
  },
};

export const VISUAL_KINDS: AnyKind[] = [timeline, statement, gallery, people, diagram, code];

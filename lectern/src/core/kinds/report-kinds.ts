// Slide types for reports, plans and product walk-throughs: text, roadmap and screenshot.
// Registered with the core kinds. All three are text, shapes and pictures, so PowerPoint
// gets them as ordinary editable boxes.

import type { Box, TextBox } from '../engine/boxes';
import { CANVAS_H } from '../engine/boxes';
import { DENSITY, M, type LayoutContext, heightAt, imageSrc, read, shape, slideTitle, sz, text } from './kit';
import { sliceColors } from './data-kinds';
import type { AnyKind, KindLayout, SlideKindDefinition } from './types';

type C = Record<string, unknown>;
type Item = Record<string, unknown>;

function field(o: Item, key: string) {
  return String(o[key] ?? '').trim();
}

/** Items with at least one filled field. The original index is kept so `bind` still points at the right row. */
function items(c: C, key: string, max: number) {
  return read.objects<Item>(c, key)
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => Object.values(o).some((v) => typeof v === 'string' && v.trim()))
    .slice(0, max);
}

// ─── Text ─────────────────────────────────────────────────────────────

/** Paragraphs of a text, split at blank lines. A single line break stays inside its paragraph. */
export function paragraphs(value: string): string[] {
  return value.replace(/\r/g, '').split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
}

/** A paragraph's sentences, for sharing one long paragraph over two columns. */
function sentences(value: string): string[] {
  return value.match(/[^.!?。！？]+(?:[.!?。！？]+["”’)\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [value];
}

/** Text slides are for reading, so they may carry several times the words of a glance-at slide. */
const READING = 4;

const BODY = { max: 40, min: 22, lh: 1.45 };

const textKind: SlideKindDefinition<C> = {
  kind: 'text', label: 'Text', description: 'A heading and a few paragraphs, in one or two columns: a summary, a report page or a passage to read.', icon: 'align-left', group: 'Explain',
  variants: [{ id: 'one', label: 'One column' }, { id: 'two', label: 'Two columns' }],
  autoVariant: (c) => {
    const body = read.str(c, 'body');
    return body.length > 520 || paragraphs(body).length >= 3 ? 'two' : 'one';
  },
  fields: [
    { key: 'eyebrow', label: 'Above the title', type: 'text', placeholder: 'Summary, chapter or section', more: true },
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'body', label: 'Text', type: 'textarea', rows: 8, help: 'Leave a blank line between paragraphs.' },
    { key: 'note', label: 'Source or footnote', type: 'text', more: true },
  ],
  create: () => ({
    eyebrow: '',
    title: 'What we learned',
    body: 'Short meetings with a clear goal ended on time nine times out of ten. Long ones rarely did.\n\nTeams that wrote the goal down first spent less time on status updates and more on decisions.',
    note: '',
  }),
  heading: (c) => read.str(c, 'title') || 'Text',
  text: (c) => [read.str(c, 'eyebrow'), read.str(c, 'title'), ...paragraphs(read.str(c, 'body')), read.str(c, 'note')].filter(Boolean),
  layout(c, ctx, variant) {
    const colors = ctx.theme.colors;
    const boxes: Box[] = [];
    let top = M.top;
    const eb = read.str(c, 'eyebrow').trim();
    if (eb) {
      const e = text(ctx, { id: 'eyebrow', text: eb, x: M.x, y: top, w: M.w, h: sz(ctx, 30) * 1.4, max: 28, min: 20, weight: 700, color: colors.accent, tracking: 0.12, uppercase: true, maxLines: 1, hug: true, bind: 'eyebrow' });
      boxes.push(e);
      top = e.y + e.h + sz(ctx, 12);
    }
    const t = text(ctx, { id: 'title', text: read.str(c, 'title') || ' ', x: M.x, y: top, w: M.w - 120, h: sz(ctx, 72) * 1.08 * 2, role: 'display', max: 72, min: 48, maxLines: 2, hug: true, bind: 'title' });
    boxes.push(t);
    const note = read.str(c, 'note').trim();
    const noteSize = sz(ctx, 24);
    const noteH = note ? Math.ceil(noteSize * 1.3) : 0;
    const y = t.y + t.h + sz(ctx, 36);
    const h = M.bottom - y - (note ? noteH + 24 : 0);
    const parts = paragraphs(read.str(c, 'body'));
    if (parts.length) boxes.push(...(variant === 'two' ? twoColumns(ctx, parts, y, h) : oneColumn(ctx, parts, y, h)));
    if (note) boxes.push(text(ctx, { id: 'note', text: note, x: M.x, y: M.bottom - noteH, w: M.w, h: noteH, max: 24, min: 18, color: colors.muted, maxLines: 1, bind: 'note' }));
    return { boxes, budget: DENSITY[ctx.audience].words * READING };
  },
};

/** One column, kept to a comfortable line length. */
function oneColumn(ctx: LayoutContext, parts: string[], y: number, h: number): Box[] {
  return [text(ctx, {
    id: 'body', text: parts.join('\n\n'), x: M.x, y, w: Math.min(M.w, 1320), h, max: BODY.max, min: BODY.min, lh: BODY.lh, hug: true, bind: 'body',
  })];
}

/**
 * Two columns at one size: the largest at which some split of the paragraphs fits both.
 * One long paragraph is shared out by sentence instead.
 */
function twoColumns(ctx: LayoutContext, parts: string[], y: number, h: number): Box[] {
  const gap = 96;
  const w = (M.w - gap) / 2;
  const units = parts.length > 1 ? parts : sentences(parts[0]!);
  const join = parts.length > 1 ? '\n\n' : ' ';
  if (units.length < 2) return oneColumn(ctx, parts, y, h);
  const max = sz(ctx, BODY.max);
  const min = Math.min(max, sz(ctx, BODY.min));
  const height = (value: string, size: number) => heightAt(ctx, value, size, w, 'body', BODY.lh);
  let best = { size: min, k: Math.ceil(units.length / 2) };
  search: for (let size = max; size >= min; size -= 2) {
    // The split that leaves the two columns closest in height.
    let pick: { k: number; tall: number } | null = null;
    for (let k = 1; k < units.length; k++) {
      const tall = Math.max(height(units.slice(0, k).join(join), size), height(units.slice(k).join(join), size));
      if (!pick || tall < pick.tall) pick = { k, tall };
    }
    best = { size, k: pick!.k };
    if (pick!.tall <= h) break search;
  }
  const left = units.slice(0, best.k).join(join);
  const right = units.slice(best.k).join(join);
  if (Math.max(height(left, best.size), height(right, best.size)) > h) ctx.warnings.push('Text is too long to fit: this slide’s text. Shorten it or move some to the key notes.');
  const column = (id: string, value: string, x: number): TextBox => text(ctx, {
    id, text: value, x, y, w, h, max: best.size, min: best.size, scaled: false, lh: BODY.lh, hug: true, bind: 'body',
  });
  const a = column('body-0', left, M.x);
  const b = column('body-1', right, M.x + w + gap);
  return [a, b];
}

// ─── Roadmap ──────────────────────────────────────────────────────────

/** The time periods across the top, from "Q1, Q2, Q3" or one per line. */
export function periodsOf(value: string): string[] {
  return value.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean).slice(0, 12);
}

/** Which period a bar's "from" or "to" names: by name (whole or in part), or by number from 1. -1 when none. */
export function periodIndex(value: string, periods: string[]): number {
  const v = value.trim().toLowerCase();
  if (!v) return -1;
  const names = periods.map((p) => p.trim().toLowerCase());
  const exact = names.indexOf(v);
  if (exact >= 0) return exact;
  const part = names.findIndex((p) => p.startsWith(v) || v.startsWith(p));
  if (part >= 0) return part;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= periods.length ? n - 1 : -1;
}

export interface RoadmapBar { i: number; lane: number; row: number; from: number; to: number; label: string }

/**
 * The bars a roadmap draws: each one's span of periods, its workstream and its row within it.
 * Bars that overlap in time in one workstream take separate rows, so none hides another.
 */
export function roadmapBars(c: C): { lanes: string[]; rows: number[]; bars: RoadmapBar[]; periods: string[]; skipped: string[] } {
  const periods = periodsOf(read.str(c, 'periods'));
  const lanes: string[] = [];
  const rows: number[] = [];
  const ends: number[][] = [];
  const bars: RoadmapBar[] = [];
  const skipped: string[] = [];
  for (const { o, i } of items(c, 'bars', 12)) {
    let from = periodIndex(field(o, 'from'), periods);
    let to = periodIndex(field(o, 'to'), periods);
    if (from < 0) from = to;
    if (to < 0) to = from;
    if (from < 0) { skipped.push(field(o, 'label') || field(o, 'lane') || `Bar ${i + 1}`); continue; }
    if (to < from) [from, to] = [to, from];
    const name = field(o, 'lane');
    let lane = lanes.findIndex((l) => l.toLowerCase() === name.toLowerCase());
    if (lane < 0) { lane = lanes.length; lanes.push(name); ends.push([]); }
    let row = ends[lane]!.findIndex((end) => end < from);
    if (row < 0) { row = ends[lane]!.length; ends[lane]!.push(to); } else ends[lane]![row] = to;
    bars.push({ i, lane, row, from, to, label: field(o, 'label') });
  }
  ends.forEach((e, k) => { rows[k] = Math.max(1, e.length); });
  return { lanes, rows, bars, periods, skipped };
}

const roadmap: SlideKindDefinition<C> = {
  kind: 'roadmap', label: 'Roadmap', description: 'Workstreams across a time axis, with a bar for how long each piece of work runs, and a line for now.', icon: 'gantt', group: 'Explain',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'periods', label: 'Time periods', type: 'text', placeholder: 'Q1, Q2, Q3, Q4', help: 'The columns, left to right, separated by commas.' },
    { key: 'bars', label: 'Work', type: 'objects', itemLabel: 'Bar', max: 12, min: 1, help: 'Bars with the same workstream share a row.', fields: [
      { key: 'lane', label: 'Workstream or team', type: 'text', placeholder: 'Design' },
      { key: 'label', label: 'What', type: 'text', placeholder: 'New onboarding' },
      { key: 'from', label: 'From', type: 'text', placeholder: 'Q1', help: 'A period from the list above.' },
      { key: 'to', label: 'To', type: 'text', placeholder: 'Q2', help: 'Optional. Leave it empty for one period.' },
    ] },
    { key: 'now', label: 'Now', type: 'text', placeholder: 'Q2', help: 'Optional. A line marks this period as now.', more: true },
    { key: 'reveal', label: 'Reveal one workstream at a time', type: 'toggle' },
  ],
  create: () => ({
    title: 'Roadmap',
    periods: 'Q1, Q2, Q3, Q4',
    bars: [
      { lane: 'Product', label: 'New editor', from: 'Q1', to: 'Q2' },
      { lane: 'Product', label: 'Templates', from: 'Q3', to: 'Q4' },
      { lane: 'Design', label: 'Research', from: 'Q1', to: 'Q1' },
      { lane: 'Design', label: 'Design system', from: 'Q2', to: 'Q3' },
      { lane: 'Engineering', label: 'Platform', from: 'Q1', to: 'Q3' },
      { lane: 'Marketing', label: 'Launch', from: 'Q4', to: 'Q4' },
    ],
    now: 'Q2',
    reveal: false,
  }),
  heading: (c) => read.str(c, 'title') || 'Roadmap',
  text: (c) => {
    const { lanes, bars } = roadmapBars(c);
    return [read.str(c, 'title'), ...lanes, ...bars.map((b) => b.label)].filter((s) => s.trim());
  },
  layout(c, ctx) {
    const colors = ctx.theme.colors;
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    const { lanes, rows, bars, periods, skipped } = roadmapBars(c);
    if (!periods.length) {
      if (ctx.mode === 'edit') boxes.push(text(ctx, { id: 'hint', text: 'Add time periods, such as Q1, Q2, Q3, Q4.', x: M.x, y: bottom + 40, w: M.w, h: 60, max: 32, min: 24, color: colors.muted, bind: 'periods' }));
      return { boxes };
    }
    if (skipped.length) ctx.warnings.push(`Some bars aren’t shown because their dates don’t match a time period: ${skipped.slice(0, 3).join(', ')}.`);
    if (items(c, 'bars', 99).length > 12) ctx.warnings.push('Only the first twelve bars fit. Move the rest to another roadmap.');
    const reveal = read.bool(c, 'reveal');
    const named = lanes.some(Boolean);
    const laneW = named ? 300 : 0;
    const gridX = M.x + (named ? laneW + 32 : 0);
    const gridW = M.right - gridX;
    const colW = gridW / periods.length;
    const headH = Math.ceil(sz(ctx, 28) * 1.5);
    const top = bottom + headH + 12;
    const laneGap = 14;
    const totalRows = rows.reduce((a, b) => a + b, 0) || 1;
    const areaH = M.bottom - top - laneGap * Math.max(0, lanes.length - 1);
    const rowH = Math.min(sz(ctx, 92), areaH / totalRows);
    const barH = Math.round(rowH * 0.74);
    const now = periodIndex(read.str(c, 'now'), periods);
    const gridH = rowH * totalRows + laneGap * Math.max(0, lanes.length - 1);

    periods.forEach((p, k) => {
      const x = gridX + k * colW;
      if (k > 0) boxes.push(shape({ id: `col-${k}`, shape: 'rect', x: x - 1, y: bottom, w: 2, h: headH + 12 + gridH, fill: colors.line }));
      boxes.push(text(ctx, {
        id: `period-${k}`, text: p, x: x + 8, y: bottom, w: colW - 16, h: headH, max: 28, min: 16, weight: k === now ? 800 : 700,
        color: k === now ? colors.accent : colors.muted, align: 'center', valign: 'middle', maxLines: 1, tracking: 0.04, bind: 'periods',
      }));
    });

    const fills = sliceColors(ctx.theme, Math.max(1, lanes.length));
    let y = top;
    lanes.forEach((name, lane) => {
      const h = rowH * rows[lane]!;
      const step = reveal ? lane + 1 : undefined;
      if (lane % 2 === 0) boxes.push(shape({ id: `band-${lane}`, shape: 'rect', x: M.x - 16, y: y - laneGap / 2, w: M.w + 32, h: h + laneGap, fill: colors.surface, radius: ctx.theme.radius, opacity: 0.7, step }));
      const first = bars.find((b) => b.lane === lane);
      if (name && first) {
        boxes.push(text(ctx, { id: `lane-${lane}`, text: name, x: M.x, y, w: laneW, h, max: 32, min: 20, weight: 700, valign: 'middle', maxLines: 2, step, bind: `bars.${first.i}.lane` }));
      }
      for (const b of bars.filter((x) => x.lane === lane)) {
        const bx = gridX + b.from * colW + 6;
        const bw = (b.to - b.from + 1) * colW - 12;
        const by = y + b.row * rowH + (rowH - barH) / 2;
        const lead = `bar-${b.i}-label`;
        boxes.push(shape({ id: `bar-${b.i}`, shape: 'rect', x: bx, y: by, w: bw, h: barH, radius: Math.min(ctx.theme.radius, barH / 2), fill: fills[lane]!, step, moveWith: lead }));
        boxes.push(text(ctx, { id: lead, text: b.label || ' ', x: bx + 18, y: by, w: Math.max(40, bw - 36), h: barH, max: 28, min: 16, weight: 650, color: colors.onAccent, valign: 'middle', maxLines: 1, step, bind: `bars.${b.i}.label` }));
      }
      y += h + laneGap;
    });

    if (now >= 0) {
      const x = gridX + (now + 0.5) * colW;
      boxes.push(shape({ id: 'now', shape: 'rect', x: x - 2, y: bottom + headH, w: 4, h: gridH + 12, fill: colors.accent, radius: 2, opacity: 0.85 }));
    }
    return { boxes };
  },
};

// ─── Screenshot ───────────────────────────────────────────────────────

interface Area { x: number; y: number; w: number; h: number }

/** A callout's place on the screenshot, as fractions of its width and height (0 to 1). */
export function calloutAt(o: Item, k: number, n: number): { x: number; y: number } {
  const pct = (v: string, fallback: number) => {
    const m = /-?\d+(?:\.\d+)?/.exec(v);
    const x = m ? Number(m[0]) : NaN;
    return Number.isFinite(x) ? Math.max(0, Math.min(100, x)) / 100 : fallback;
  };
  // Callouts without a place spread down the middle until someone drags them.
  return { x: pct(field(o, 'x'), 0.5), y: pct(field(o, 'y'), (k + 1) / (n + 1)) };
}

/** Traffic lights, an address bar and the picture: a browser window. Returns the boxes and where the page sits. */
function browserFrame(ctx: LayoutContext, area: Area, src: string, url: string): { boxes: Box[]; screen: Area } {
  const colors = ctx.theme.colors;
  const bar = 56;
  let w = area.w;
  let sh = w * 10 / 16;
  if (sh + bar > area.h) { sh = area.h - bar; w = sh * 16 / 10; }
  const x = Math.round(area.x + (area.w - w) / 2);
  const y = Math.round(area.y + (area.h - sh - bar) / 2);
  const boxes: Box[] = [
    shape({ id: 'frame', shape: 'rect', x, y, w, h: sh + bar, fill: colors.surface, stroke: colors.line, strokeWidth: 2, radius: 18, moveWith: 'screen' }),
  ];
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((fill, k) => boxes.push(shape({ id: `light-${k}`, shape: 'ellipse', x: x + 24 + k * 26, y: y + bar / 2 - 8, w: 16, h: 16, fill, moveWith: 'screen' })));
  if (url) {
    const ux = x + 120;
    const uw = Math.min(w - 240, 760);
    boxes.push(shape({ id: 'address', shape: 'rect', x: ux, y: y + 11, w: uw, h: bar - 22, fill: colors.bg, radius: (bar - 22) / 2, moveWith: 'screen' }));
    boxes.push(text(ctx, { id: 'url', text: url, x: ux + 20, y: y + 11, w: uw - 40, h: bar - 22, max: 20, min: 14, scaled: false, color: colors.muted, valign: 'middle', maxLines: 1, bind: 'url' }));
  }
  const screen = { x: x + 2, y: y + bar, w: w - 4, h: sh - 2 };
  boxes.push(shape({ id: 'screen-bg', shape: 'rect', ...screen, fill: colors.bg, moveWith: 'screen' }));
  boxes.push(...screenPicture(ctx, src, screen, 0));
  return { boxes, screen };
}

/** A phone: a dark body with rounded corners round the picture. */
function phoneFrame(ctx: LayoutContext, area: Area, src: string): { boxes: Box[]; screen: Area } {
  const bezel = 16;
  let h = area.h;
  let w = (h - bezel * 2) * 9 / 19.5 + bezel * 2;
  if (w > area.w) { w = area.w; h = (w - bezel * 2) * 19.5 / 9 + bezel * 2; }
  const x = Math.round(area.x + (area.w - w) / 2);
  const y = Math.round(area.y + (area.h - h) / 2);
  const screen = { x: x + bezel, y: y + bezel, w: w - bezel * 2, h: h - bezel * 2 };
  return {
    boxes: [
      shape({ id: 'frame', shape: 'rect', x, y, w, h, fill: '#16161A', radius: 64, moveWith: 'screen' }),
      shape({ id: 'screen-bg', shape: 'rect', ...screen, fill: ctx.theme.colors.bg, radius: 48, moveWith: 'screen' }),
      ...screenPicture(ctx, src, screen, 48),
      shape({ id: 'notch', shape: 'rect', x: x + w / 2 - 50, y: screen.y + 14, w: 100, h: 26, fill: '#16161A', radius: 13, moveWith: 'screen' }),
    ],
    screen,
  };
}

function screenPicture(ctx: LayoutContext, src: string, a: Area, radius: number): Box[] {
  if (src) return [{ type: 'image', id: 'screen', src, ...a, fit: 'contain', radius, bind: 'image', alt: 'Screenshot' }];
  if (ctx.mode !== 'edit') return [];
  return [
    shape({ id: 'screen', shape: 'rect', ...a, stroke: ctx.theme.colors.line, strokeWidth: 3, dash: true, radius, bind: 'image' }),
    { ...text(ctx, { id: 'screen-hint', text: 'Add a screenshot', x: a.x + 24, y: a.y + a.h / 2 - 30, w: a.w - 48, h: 60, max: 30, min: 22, color: ctx.theme.colors.muted, align: 'center', valign: 'middle', scaled: false, bind: 'image' }), moveWith: 'screen' },
  ];
}

/** Numbered dots on the screenshot, each draggable to where it points. */
function calloutDots(ctx: LayoutContext, list: { o: Item; i: number }[], screen: Area): Box[] {
  const colors = ctx.theme.colors;
  const d = Math.round(sz(ctx, 54));
  return list.flatMap(({ o, i }, k) => {
    const at = calloutAt(o, k, list.length);
    const x = Math.round(Math.max(screen.x, Math.min(screen.x + screen.w - d, screen.x + at.x * screen.w - d / 2)));
    const y = Math.round(Math.max(screen.y, Math.min(screen.y + screen.h - d, screen.y + at.y * screen.h - d / 2)));
    const drag = { x: `callouts.${i}.x`, y: `callouts.${i}.y`, within: 'screen' };
    return [
      shape({ id: `dot-${i}`, shape: 'ellipse', x, y, w: d, h: d, fill: colors.accent, stroke: '#FFFFFF', strokeWidth: 4, moveWith: 'screen', drag }),
      { type: 'text', id: `dot-${i}-n`, x, y, w: d, h: d, text: String(k + 1), moveWith: `dot-${i}`,
        style: { font: 'body', size: Math.round(d * 0.5), weight: 800, color: colors.onAccent, align: 'center', valign: 'middle', lineHeight: 1 } } satisfies TextBox,
    ];
  });
}

/** The callouts' words beside the frame, each after its number. */
function calloutList(ctx: LayoutContext, list: { o: Item; i: number }[], a: Area): Box[] {
  const colors = ctx.theme.colors;
  if (!list.length) return [];
  const d = Math.round(sz(ctx, 48));
  const gap = sz(ctx, 34);
  const textX = a.x + d + 24;
  const textW = a.w - d - 24;
  const rows = list.map(({ o, i }) => text(ctx, { id: `callout-${i}`, text: field(o, 'label') || ' ', x: textX, y: 0, w: textW, h: sz(ctx, 36) * 1.3 * 3, max: 36, min: 24, maxLines: 3, hug: true, bind: `callouts.${i}.label` }));
  const total = rows.reduce((s, r) => s + Math.max(r.h, d), 0) + gap * (rows.length - 1);
  let y = a.y + Math.max(0, (a.h - total) / 2);
  return rows.flatMap((r, k) => {
    const rowH = Math.max(r.h, d);
    r.y = y + (rowH - r.h) / 2;
    const by = r.y + Math.min(r.h, r.style.size * 1.3) / 2 - d / 2;
    y += rowH + gap;
    return [
      shape({ id: `${r.id}-m`, shape: 'ellipse', x: a.x, y: by, w: d, h: d, fill: colors.accent, moveWith: r.id }),
      { type: 'text', id: `${r.id}-n`, x: a.x, y: by, w: d, h: d, text: String(k + 1), moveWith: r.id,
        style: { font: 'body', size: Math.round(d * 0.5), weight: 800, color: colors.onAccent, align: 'center', valign: 'middle', lineHeight: 1 } } satisfies TextBox,
      r,
    ];
  });
}

const screenshot: SlideKindDefinition<C> = {
  kind: 'screenshot', label: 'Screenshot', description: 'A screenshot in a browser or phone frame, with numbered callouts that point out what matters.', icon: 'app-window', group: 'Visual',
  variants: [{ id: 'browser', label: 'Browser' }, { id: 'phone', label: 'Phone' }],
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'image', label: 'Screenshot', type: 'image' },
    { key: 'url', label: 'Address bar', type: 'text', placeholder: 'example.com/page', help: 'Optional. Shown in the browser frame.' },
    { key: 'callouts', label: 'Callouts', type: 'objects', itemLabel: 'Callout', max: 5, help: 'Each gets a numbered dot on the screenshot. Drag a dot on the slide to place it.', fields: [
      { key: 'label', label: 'What it shows', type: 'text' },
      { key: 'x', label: 'Across (%)', type: 'text', placeholder: '50', help: 'From the left edge (0) to the right (100).' },
      { key: 'y', label: 'Down (%)', type: 'text', placeholder: '50', help: 'From the top (0) to the bottom (100).' },
    ] },
  ],
  create: () => ({
    title: 'Meet the new editor',
    image: '',
    url: 'example.com/editor',
    callouts: [
      { label: 'Click any text to type', x: '40', y: '34' },
      { label: 'Drag to move, pull a corner to resize', x: '66', y: '62' },
      { label: 'Layouts live in the toolbar', x: '24', y: '12' },
    ],
  }),
  heading: (c) => read.str(c, 'title') || 'Screenshot',
  text: (c) => [read.str(c, 'title'), ...items(c, 'callouts', 5).map(({ o }) => field(o, 'label'))].filter((s) => s.trim()),
  layout(c, ctx, variant): KindLayout {
    const src = imageSrc(ctx, c.image);
    const list = items(c, 'callouts', 5).filter(({ o }) => field(o, 'label'));
    if (read.objects(c, 'callouts').length > 5) ctx.warnings.push('Only the first five callouts fit. Move the rest to another screenshot slide.');
    const boxes: Box[] = [];
    if (variant === 'phone') {
      // The phone stands tall on the left; the title and callouts read down the right.
      const area = { x: M.x + 40, y: M.top - 32, w: 560, h: CANVAS_H - (M.top - 32) * 2 };
      const phone = phoneFrame(ctx, area, src);
      const frame = phone.boxes[0]!;
      const x = frame.x + frame.w + 120;
      const t = text(ctx, { id: 'title', text: read.str(c, 'title') || ' ', x, y: M.top + 20, w: M.right - x, h: sz(ctx, 72) * 1.08 * 3, role: 'display', max: 72, min: 46, maxLines: 3, hug: true, bind: 'title' });
      boxes.push(...phone.boxes, ...calloutDots(ctx, list, phone.screen), t);
      const top = t.y + t.h + sz(ctx, 48);
      boxes.push(...calloutList(ctx, list, { x, y: top, w: M.right - x, h: M.bottom - top }));
      return { boxes };
    }
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const side = list.length ? 560 : 0;
    const area = { x: M.x, y: bottom, w: M.w - (side ? side + 72 : 0), h: M.bottom - bottom };
    const browser = browserFrame(ctx, area, src, read.str(c, 'url').trim());
    const frame = browser.boxes[0]!;
    boxes.push(box, ...browser.boxes, ...calloutDots(ctx, list, browser.screen));
    const lx = frame.x + frame.w + 72;
    boxes.push(...calloutList(ctx, list, { x: lx, y: bottom, w: M.right - lx, h: M.bottom - bottom }));
    return { boxes };
  },
};

export const REPORT_KINDS: AnyKind[] = [textKind, roadmap, screenshot];

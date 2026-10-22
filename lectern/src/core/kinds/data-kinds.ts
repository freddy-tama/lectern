// Data slide types: charts and tables. Registered with the core kinds.
// Both lay out a single box that the screen draws itself and PowerPoint gets
// as a native, editable chart or table.

import type { Box, ChartBox, TableBox } from '../engine/boxes';
import { cssFont, wrapLines } from '../engine/measure';
import type { Theme } from '../engine/themes';
import { M, type LayoutContext, fam, read, shape, slideTitle, sz, text } from './kit';
import type { AnyKind, SlideKindDefinition } from './types';

type C = Record<string, unknown>;

// ─── Numbers ──────────────────────────────────────────────────────────

/** Reads a number typed by a person: "1,200", "$45", "12.5%". Anything else is 0. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value ?? '').trim().replace(/[\s,_']/g, '').replace(/^\((.*)\)$/, '-$1').replace(/[−–]/g, '-');
  const m = /\d*\.?\d+(?:e[-+]?\d+)?/i.exec(s);
  if (!m) return 0;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return 0;
  return s.startsWith('-') ? -n : n;
}

function decimalsOf(n: number) {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = String(Math.abs(n));
  const d = s.includes('e-') ? Number(s.split('e-')[1]) : (s.split('.')[1] ?? '').length;
  return Math.min(2, d);
}

/** A value axis with round numbers that includes zero. */
export function niceAxis(lo: number, hi: number, target = 5) {
  let min = Math.min(0, lo);
  let max = Math.max(0, hi);
  if (min === max) max = min + 1;
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw * 0.999) ?? 10 * mag;
  const fix = (n: number) => Number(n.toPrecision(12));
  min = fix(Math.floor(min / step + 1e-9) * step);
  max = fix(Math.ceil(max / step - 1e-9) * step);
  return { min, max, step: fix(step) };
}

/** A value with its unit, as the chart shows it: "$1,200", "45%", "12 kg". */
export function formatChartValue(value: number, unit = '', position: 'before' | 'after' = 'after', decimals = 0): string {
  const body = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = value < 0 && Number(body.replace(/,/g, '')) !== 0 ? '-' : '';
  if (!unit) return sign + body;
  if (position === 'before') return `${sign}${unit}${body}`;
  return `${sign}${body}${/^[\p{L}]{2,}/u.test(unit) ? ' ' : ''}${unit}`;
}

// ─── Colours ──────────────────────────────────────────────────────────

function rgb(color: string): [number, number, number] {
  let h = color.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

function toHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function distance(a: string, b: string) {
  const x = rgb(a);
  const y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function luminance(color: string) {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Two series colours: the accent, then the second accent when it stands out from the background, else the muted ink. */
export function seriesColors(theme: Theme): string[] {
  const c = theme.colors;
  const second = distance(c.accent2, c.bg) > 100 && distance(c.accent2, c.accent) > 100 ? c.accent2 : c.muted;
  return [c.accent, second];
}

/**
 * Slice colours: shades of the accent that all keep the label colour (onAccent)
 * readable, so value labels can sit on every slice.
 */
export function sliceColors(theme: Theme, n: number): string[] {
  const c = theme.colors;
  const lightLabel = luminance(c.onAccent) > 0.4;
  let toward = lightLabel ? '#000000' : '#FFFFFF';
  let reach = 0.62;
  if (distance(c.accent, toward) < 90) {
    // The accent is already near black (or white): step the other way, but not so far the label fades.
    toward = lightLabel ? '#FFFFFF' : '#000000';
    reach = 0.42;
  }
  const order = [0, 0.55, 0.22, 0.78, 0.4, 0.1, 0.66, 0.3, 0.9, 0.48, 0.16, 0.6];
  return Array.from({ length: n }, (_, i) => mix(c.accent, toward, order[i % order.length] * reach));
}

// ─── Chart ────────────────────────────────────────────────────────────

const CHART_TYPES = ['column', 'bar', 'line', 'pie', 'doughnut'] as const;
type ChartType = (typeof CHART_TYPES)[number];

interface ChartRow { label: string; value: number; value2: number; hasValue2: boolean }

function chartRows(c: C): ChartRow[] {
  return read.objects<C>(c, 'rows')
    .map((r) => ({ label: read.str(r, 'label').trim(), raw: read.str(r, 'value').trim(), raw2: read.str(r, 'value2').trim() }))
    .filter((r) => r.label || r.raw || r.raw2)
    .map((r) => ({ label: r.label, value: toNumber(r.raw), value2: toNumber(r.raw2), hasValue2: r.raw2 !== '' }));
}

const TIME_LABEL = /^(q[1-4]|h[12]|fy|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|week|day|month|year|'\d\d|\d{4}|\d{1,2}[/:-]\d)/i;

/**
 * The chart that suits the numbers: parts of a whole as a doughnut, a series over time as a line,
 * long labels as bars, everything else as columns.
 */
export function autoChart(rows: ChartRow[]): ChartType {
  if (!rows.length) return 'column';
  const two = rows.some((r) => r.hasValue2);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  if (!two && rows.length >= 2 && rows.length <= 6 && rows.every((r) => r.value >= 0) && total >= 98 && total <= 102) return 'doughnut';
  if (rows.length >= 4 && rows.filter((r) => TIME_LABEL.test(r.label)).length >= rows.length - 1) return 'line';
  if (rows.length > 7 || rows.some((r) => r.label.length > 14)) return 'bar';
  return 'column';
}

export function chartTypeOf(variant: string | undefined): ChartType {
  return (CHART_TYPES as readonly string[]).includes(variant ?? '') ? variant as ChartType : 'column';
}

/** Builds the chart box for a content area. Exported so other kinds can place a chart too. */
export function chartBox(ctx: LayoutContext, c: C, variant: string | undefined, area: { x: number; y: number; w: number; h: number }, extra: Partial<ChartBox> = {}): ChartBox | null {
  const chart = chartTypeOf(variant);
  const rows = chartRows(c);
  if (!rows.length) return null;
  const round = chart === 'pie' || chart === 'doughnut';
  const two = !round && rows.some((r) => r.hasValue2);
  const labels = rows.map((r) => r.label);
  const series = [{ name: read.str(c, 'series').trim() || 'Series 1', values: rows.map((r) => (round ? Math.max(0, r.value) : r.value)) }];
  if (two) series.push({ name: read.str(c, 'series2').trim() || 'Series 2', values: rows.map((r) => r.value2) });
  const all = series.flatMap((s) => s.values);
  const decimals = Math.max(0, ...all.map(decimalsOf));
  const unit = read.str(c, 'unit').trim().replace(/["&<>\\]/g, '').slice(0, 8);
  const showValues = read.bool(c, 'values', true);
  const colors = round ? sliceColors(ctx.theme, rows.length) : seriesColors(ctx.theme).slice(0, series.length);
  let axis: ChartBox['axis'];
  if (!round) {
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    axis = niceAxis(lo, hi);
    // Leave room above the tallest bar for its label.
    if (showValues && hi > 0 && axis.max - hi < axis.step * 0.2) axis = { ...axis, max: Number((axis.max + axis.step).toPrecision(12)) };
  }
  const box: ChartBox = {
    type: 'chart', id: 'chart', ...area, chart, labels, series, colors,
    font: 'body', fontSize: sz(ctx, 26),
    textColor: ctx.theme.colors.muted, valueColor: ctx.theme.colors.ink, insideColor: ctx.theme.colors.onAccent,
    gridColor: ctx.theme.colors.line, edgeColor: ctx.theme.colors.bg,
    showValues, showLegend: read.bool(c, 'legend', true) && (round || series.length > 1),
    unit, unitPosition: read.bool(c, 'unitBefore') ? 'before' : 'after', decimals, axis,
    bind: 'rows', ...extra,
  };
  if (!round) checkCategoryLabels(ctx, box);
  return box;
}

/** Warns when category names are too wide for their slot under a column or line chart. */
function checkCategoryLabels(ctx: LayoutContext, box: ChartBox) {
  if (box.chart === 'bar') return;
  const font = cssFont(fam(ctx, box.font), box.fontSize, 400);
  const axisW = box.fontSize * 4;
  const slot = (box.w - axisW) / Math.max(1, box.labels.length);
  const tooWide = box.labels.some((l) => l && wrapLines(l, slot * 0.92, font, ctx.measure).length > 2);
  if (tooWide) ctx.warnings.push('Some chart labels are too long to fit under their columns. Shorten them, or switch to the bar layout.');
}

const chart: SlideKindDefinition<C> = {
  kind: 'chart', label: 'Chart', description: 'A column, bar, line, pie or doughnut chart that stays editable in PowerPoint.', icon: 'chart-column', group: 'Data',
  variants: [
    { id: 'column', label: 'Columns' }, { id: 'bar', label: 'Bars' }, { id: 'line', label: 'Line' },
    { id: 'pie', label: 'Pie' }, { id: 'doughnut', label: 'Doughnut' },
  ],
  autoVariant: (c) => autoChart(chartRows(c)),
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'rows', label: 'Data', type: 'objects', itemLabel: 'Row', max: 12, min: 1, help: 'Leave the second value empty for a single series. Pie and doughnut use the first value only.', fields: [
      { key: 'label', label: 'Label', type: 'text', placeholder: 'Q1' },
      { key: 'value', label: 'Value', type: 'text', placeholder: '42' },
      { key: 'value2', label: 'Second value', type: 'text', placeholder: 'Optional' },
    ] },
    { key: 'series', label: 'First series name', type: 'text', placeholder: 'This year' },
    { key: 'series2', label: 'Second series name', type: 'text', placeholder: 'Last year' },
    { key: 'unit', label: 'Unit', type: 'text', placeholder: '%, $, kg…' },
    { key: 'unitBefore', label: 'Put the unit before the number', type: 'toggle', help: 'For currencies, like $40.' },
    { key: 'takeaway', label: 'Takeaway', type: 'textarea', rows: 2, help: 'One line that says what the chart shows.' },
    { key: 'values', label: 'Show values', type: 'toggle' },
    { key: 'legend', label: 'Show legend', type: 'toggle', help: 'Shown for two series, and for pie and doughnut charts.' },
    { key: 'reveal', label: 'Show the takeaway on click', type: 'toggle' },
  ],
  create: () => ({
    title: 'Revenue by quarter',
    rows: [
      { label: 'Q1', value: '42', value2: '38' },
      { label: 'Q2', value: '55', value2: '41' },
      { label: 'Q3', value: '61', value2: '50' },
      { label: 'Q4', value: '78', value2: '57' },
    ],
    series: 'This year', series2: 'Last year', unit: '$', unitBefore: true,
    takeaway: 'Q4 was our best quarter, up 37% on last year.',
    values: true, legend: true, reveal: false,
  }),
  heading: (c) => read.str(c, 'title') || 'Chart',
  text: (c) => {
    const rows = chartRows(c);
    const two = rows.some((r) => r.hasValue2);
    return [
      read.str(c, 'title'),
      ...rows.map((r) => r.label),
      rows.length ? read.str(c, 'series') : '',
      two ? read.str(c, 'series2') : '',
      read.str(c, 'takeaway'),
    ].filter((s) => s.trim());
  },
  layout(c, ctx, variant) {
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    let chartBottom = M.bottom;
    const takeaway = read.str(c, 'takeaway').trim();
    if (takeaway) {
      const step = read.bool(c, 'reveal') ? 1 : undefined;
      const bar = 10;
      const t = text(ctx, {
        id: 'takeaway', text: takeaway, x: M.x + bar + 32, y: 0, w: M.w - bar - 32 - 120, h: sz(ctx, 40) * 1.3 * 2 + 4,
        max: 40, min: 28, weight: 600, maxLines: 2, hug: true, bind: 'takeaway', step,
      });
      t.y = M.bottom - t.h;
      boxes.push(shape({ id: 'takeaway-bar', shape: 'rect', x: M.x, y: t.y, w: bar, h: t.h, radius: bar / 2, fill: ctx.theme.colors.accent, step }));
      boxes.push(t);
      chartBottom = t.y - sz(ctx, 40);
    }
    const area = { x: M.x, y: bottom, w: M.w, h: Math.max(200, chartBottom - bottom) };
    const made = chartBox(ctx, c, variant, area);
    if (made) boxes.splice(1, 0, made);
    else if (ctx.mode === 'edit') {
      boxes.push(shape({ id: 'chart-ph', shape: 'rect', ...area, fill: ctx.theme.colors.surface, stroke: ctx.theme.colors.line, strokeWidth: 3, radius: ctx.theme.radius, dash: true, bind: 'rows' }));
      boxes.push(text(ctx, { id: 'chart-ph-t', text: 'Add some data rows', x: area.x, y: area.y + area.h / 2 - 30, w: area.w, h: 60, max: 30, min: 24, color: ctx.theme.colors.muted, align: 'center', scaled: false, bind: 'rows' }));
    }
    return { boxes };
  },
};

// ─── Table ────────────────────────────────────────────────────────────

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const NUMERIC = /^[-+−(]?\s*[$€£¥₹]?\s*\d[\d,.\s]*\)?\s*(?:%|[a-zA-Z]{1,3})?$/;

export interface ParsedTable {
  rows: string[][];
  /** Alignment per column from a Markdown separator line, when it gives one. */
  align: ('left' | 'center' | 'right' | null)[];
}

/** Reads cells pasted from a spreadsheet (tabs) or typed with | between them. Markdown separator lines are skipped. */
export function parseTable(source: string): ParsedTable {
  const rows: string[][] = [];
  let align: ParsedTable['align'] = [];
  for (const raw of String(source ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    if (TABLE_SEP.test(raw) && /[|]|-{3,}/.test(raw) && rows.length) {
      align = raw.trim().replace(/^\||\|$/g, '').split('|').map((s) => {
        const t = s.trim();
        return t.startsWith(':') && t.endsWith(':') ? 'center' : t.endsWith(':') ? 'right' : t.startsWith(':') ? 'left' : null;
      });
      continue;
    }
    let cells: string[];
    if (raw.includes('\t')) cells = raw.split('\t');
    else {
      let line = raw.trim();
      if (line.startsWith('|')) line = line.slice(1);
      if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1);
      cells = line.split(/(?<!\\)\|/).map((s) => s.replace(/\\\|/g, '|'));
    }
    rows.push(cells.map((s) => s.trim()));
  }
  const cols = Math.max(0, ...rows.map((r) => r.length));
  return { rows: rows.map((r) => [...r, ...Array(cols - r.length).fill('')]), align };
}

/** Lays out a table in an area: column widths from the text, and one font size that fits. */
export function tableBox(ctx: LayoutContext, source: string, area: { x: number; y: number; w: number; h: number }, o: { header?: boolean; stripes?: boolean; bind?: string; id?: string } = {}): TableBox | null {
  const { rows, align: given } = parseTable(source);
  if (!rows.length || !rows[0].length) return null;
  const header = o.header ?? true;
  const cols = rows[0].length;
  const body = header ? rows.slice(1) : rows;
  const align = Array.from({ length: cols }, (_, j) => {
    if (given[j]) return given[j]!;
    const values = body.map((r) => r[j]).filter((v) => v);
    return values.length && values.every((v) => NUMERIC.test(v)) ? 'right' as const : 'left' as const;
  });
  const family = fam(ctx, 'body');
  const weight = 400;
  const headerWeight = 700;
  const lh = 1.25;
  const max = sz(ctx, 34);
  const min = Math.min(max, sz(ctx, 22));
  const weightOf = (i: number) => (header && i === 0 ? headerWeight : weight);

  const tryAt = (size: number) => {
    const padX = Math.round(size * 0.65);
    const padY = Math.round(size * 0.42);
    const natural = Array<number>(cols).fill(0);
    const least = Array<number>(cols).fill(0);
    rows.forEach((r, i) => r.forEach((cell, j) => {
      const font = cssFont(family, size, weightOf(i));
      const lines = cell.split('\n');
      natural[j] = Math.max(natural[j], ...lines.map((l) => ctx.measure(l, font) / 0.97 + 2 * padX + 2));
      const longest = Math.max(0, ...cell.split(/\s+/).map((word) => ctx.measure(word, font) / 0.97));
      least[j] = Math.max(least[j], longest + 2 * padX + 2, size * 2);
    }));
    const totalNatural = natural.reduce((a, b) => a + b, 0);
    let widths: number[];
    if (totalNatural <= area.w) {
      // Spread the spare room so short columns don't end up cramped next to long ones.
      const spare = area.w - totalNatural;
      widths = natural.map((n) => n + spare / cols);
    } else {
      const totalLeast = least.reduce((a, b) => a + b, 0);
      if (totalLeast > area.w) return null;
      const want = natural.map((n, j) => n - least[j]);
      const wantSum = want.reduce((a, b) => a + b, 0) || 1;
      widths = least.map((l, j) => l + (area.w - totalLeast) * (want[j] / wantSum));
    }
    widths = widths.map((w) => Math.floor(w));
    widths[cols - 1] += area.w - widths.reduce((a, b) => a + b, 0);
    const heights = rows.map((r, i) => {
      const font = cssFont(family, size, weightOf(i));
      const lines = Math.max(1, ...r.map((cell, j) => wrapLines(cell, (widths[j] - 2 * padX) * 0.97, font, ctx.measure).length));
      return Math.ceil(lines * size * lh + 2 * padY);
    });
    const total = heights.reduce((a, b) => a + b, 0);
    return total <= area.h ? { size, padX, padY, widths, heights, total } : null;
  };

  let fit: NonNullable<ReturnType<typeof tryAt>> | null = null;
  for (let size = max; size >= min && !fit; size -= 2) fit = tryAt(size);
  if (!fit) {
    ctx.warnings.push('This table is too big for one slide. Split it, or shorten the cells.');
    const size = min;
    const padX = Math.round(size * 0.65);
    const padY = Math.round(size * 0.42);
    const widths = Array<number>(cols).fill(Math.floor(area.w / cols));
    widths[cols - 1] += area.w - widths.reduce((a, b) => a + b, 0);
    const each = Math.max(Math.ceil(size * lh + 2 * padY), Math.floor(area.h / rows.length));
    fit = { size, padX, padY, widths, heights: rows.map(() => Math.min(each, Math.floor(area.h / rows.length))), total: 0 };
    fit.total = fit.heights.reduce((a, b) => a + b, 0);
  }
  const c = ctx.theme.colors;
  return {
    type: 'table', id: o.id ?? 'table', x: area.x, y: area.y, w: area.w, h: fit.total,
    rows, header, colWidths: fit.widths, rowHeights: fit.heights,
    font: 'body', fontSize: fit.size, weight, headerWeight, lineHeight: lh, padX: fit.padX, padY: fit.padY,
    textColor: c.ink, headerFill: c.accent, headerText: c.onAccent,
    stripeFill: o.stripes ?? true ? c.surface : undefined, lineColor: c.line, align,
    bind: o.bind ?? 'cells',
  };
}

const table: SlideKindDefinition<C> = {
  kind: 'table', label: 'Table', description: 'Rows and columns, pasted from a spreadsheet or typed. Exports as a real PowerPoint table.', icon: 'table', group: 'Data',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'cells', label: 'Cells', type: 'textarea', rows: 7, placeholder: 'Plan | Seats | Price\nStarter | 1 | $0', help: 'One row per line. Put | between cells, or paste from Excel or Google Sheets.' },
    { key: 'header', label: 'First row is a header', type: 'toggle' },
    { key: 'stripes', label: 'Striped rows', type: 'toggle' },
    { key: 'caption', label: 'Caption or source', type: 'text' },
  ],
  create: () => ({
    title: 'Plans at a glance',
    cells: 'Plan | Seats | Price\nStarter | 1 | $0\nTeam | 10 | $12\nBusiness | 50 | $39',
    header: true, stripes: true, caption: 'Prices per seat, per month.',
  }),
  heading: (c) => read.str(c, 'title') || 'Table',
  text: (c) => [read.str(c, 'title'), ...parseTable(read.str(c, 'cells')).rows.flat(), read.str(c, 'caption')].filter((s) => s.trim()),
  layout(c, ctx) {
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    const caption = read.str(c, 'caption').trim();
    let areaBottom = M.bottom;
    let cap: Box | null = null;
    if (caption) {
      const t = text(ctx, { id: 'caption', text: caption, x: M.x, y: 0, w: M.w - 240, h: sz(ctx, 28) * 1.3 * 2 + 4, max: 28, min: 22, color: ctx.theme.colors.muted, maxLines: 2, hug: true, bind: 'caption' });
      areaBottom = M.bottom - t.h - sz(ctx, 24);
      cap = t;
    }
    const area = { x: M.x, y: bottom, w: M.w, h: Math.max(160, areaBottom - bottom) };
    const made = tableBox(ctx, read.str(c, 'cells'), area, { header: read.bool(c, 'header', true), stripes: read.bool(c, 'stripes', true) });
    if (made) {
      boxes.push(made);
      if (cap) { cap.y = made.y + made.h + sz(ctx, 24); boxes.push(cap); }
    } else {
      if (ctx.mode === 'edit') {
        boxes.push(shape({ id: 'table-ph', shape: 'rect', ...area, fill: ctx.theme.colors.surface, stroke: ctx.theme.colors.line, strokeWidth: 3, radius: ctx.theme.radius, dash: true, bind: 'cells' }));
        boxes.push(text(ctx, { id: 'table-ph-t', text: 'Type or paste some cells', x: area.x, y: area.y + area.h / 2 - 30, w: area.w, h: 60, max: 30, min: 24, color: ctx.theme.colors.muted, align: 'center', scaled: false, bind: 'cells' }));
      }
      if (cap) { cap.y = area.y; boxes.push(cap); }
    }
    return { boxes };
  },
};

export const DATA_KINDS: AnyKind[] = [chart, table];

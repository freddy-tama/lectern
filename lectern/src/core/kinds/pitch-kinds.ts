// Slide types for reports, pitches and talks: scorecard, pricing and contact.
// Registered with the core kinds. All three are text and shapes, so PowerPoint
// gets them as ordinary editable boxes.

import type { Box, TextBox } from '../engine/boxes';
import { CANVAS_H } from '../engine/boxes';
import { displayUrl } from '../media/embed';
import { luminance, toNumber } from './data-kinds';
import { M, type LayoutContext, card, heightAt, imageSrc, read, shape, slideTitle, sz, text } from './kit';
import { qrCard } from './media-kinds';
import type { AnyKind, SlideKindDefinition } from './types';

type C = Record<string, unknown>;
type Item = Record<string, unknown>;

/** Items with at least one filled field. The original index is kept so `bind` still points at the right row. */
function items(c: C, key: string, max: number) {
  return read.objects<Item>(c, key)
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => Object.values(o).some((v) => typeof v === 'string' && v.trim()))
    .slice(0, max);
}

function field(o: Item, key: string) {
  return String(o[key] ?? '').trim();
}

/** Ink that reads on a fill: dark on light colours, white on dark ones. */
function inkOn(fill: string) {
  return luminance(fill) > 0.4 ? '#1E1C19' : '#FFFFFF';
}

// ─── Scorecard ────────────────────────────────────────────────────────

export type Status = 'good' | 'warn' | 'bad' | 'neutral';

/** What a typed status means: "On track", "At risk", "Off track", "Done"… Anything else is neutral. */
export function statusOf(value: string): Status | null {
  const s = value.trim().toLowerCase();
  if (!s) return null;
  if (/\boff[\s-]?track\b|\bbehind\b|\bred\b|\blate\b|\bmiss(ed)?\b|\bblocked\b|\bfail/.test(s)) return 'bad';
  if (/\brisk\b|\bamber\b|\byellow\b|\bwatch\b|\bslipp?(ing|ed)?\b/.test(s)) return 'warn';
  if (/\bon[\s-]?track\b|\bgreen\b|\bgood\b|\bok\b|\bdone\b|\bhit\b|\bmet\b|\bahead\b|\bcomplete|\bachieved\b|✓/.test(s)) return 'good';
  return 'neutral';
}

function statusColor(ctx: LayoutContext, status: Status) {
  const c = ctx.theme.colors;
  const dark = luminance(c.bg) < 0.25;
  if (status === 'good') return c.good;
  if (status === 'warn') return dark ? '#E0A93B' : '#A86B00';
  if (status === 'bad') return dark ? '#F07863' : '#C0392B';
  return c.muted;
}

/** How far a measure is towards its target, from 0 to 1, or null when either isn't a number. */
export function progressOf(value: string, target: string, lowerIsBetter = false): number | null {
  if (!/\d/.test(value) || !/\d/.test(target)) return null;
  const v = toNumber(value);
  const t = toNumber(target);
  if (lowerIsBetter) return v <= 0 ? 1 : Math.max(0, Math.min(1, t / v));
  if (t === 0) return null;
  return Math.max(0, Math.min(1, v / t));
}

const scorecard: SlideKindDefinition<C> = {
  kind: 'scorecard', label: 'Scorecard', description: 'Goals against their targets, each with a progress bar and a status such as on track, at risk or off track.', icon: 'gauge', group: 'Data',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'metrics', label: 'Measures', type: 'objects', itemLabel: 'Measure', max: 6, min: 1, help: 'One to six. The bar fills to the value as a share of the target.', fields: [
      { key: 'label', label: 'Measure', type: 'text', placeholder: 'Active users' },
      { key: 'value', label: 'Now', type: 'text', placeholder: '8,200' },
      { key: 'target', label: 'Target', type: 'text', placeholder: '10,000' },
      { key: 'status', label: 'Status', type: 'text', placeholder: 'On track, at risk, off track or done', help: 'Optional. Coloured by what it says.' },
      { key: 'note', label: 'Note', type: 'text', help: 'Optional. A few words.' },
      { key: 'lower', label: 'Lower is better', type: 'toggle', help: 'For costs, churn or response times.' },
    ] },
    { key: 'reveal', label: 'Reveal measures one at a time', type: 'toggle' },
  ],
  create: () => ({
    title: 'This quarter',
    metrics: [
      { label: 'Active users', value: '8,200', target: '10,000', status: 'On track', note: '', lower: false },
      { label: 'Paid teams', value: '310', target: '400', status: 'At risk', note: '', lower: false },
      { label: 'Churn', value: '2.1%', target: '2%', status: 'On track', note: '', lower: true },
      { label: 'Launches', value: '3', target: '3', status: 'Done', note: '', lower: false },
    ],
    reveal: false,
  }),
  heading: (c) => read.str(c, 'title') || 'Scorecard',
  text: (c) => [read.str(c, 'title'), ...items(c, 'metrics', 6).flatMap(({ o }) => [field(o, 'label'), field(o, 'value'), field(o, 'status'), field(o, 'note')])].filter(Boolean),
  layout(c, ctx) {
    const list = items(c, 'metrics', 6);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    if (read.objects(c, 'metrics').length > 6) ctx.warnings.push('Only the first six measures fit. Move the rest to another scorecard.');
    if (!list.length) return { boxes };
    const colors = ctx.theme.colors;
    const reveal = read.bool(c, 'reveal');
    const statuses = list.map(({ o }) => statusOf(field(o, 'status')));
    const anyStatus = statuses.some(Boolean);
    const n = list.length;
    const areaH = M.bottom - bottom;
    const rowH = Math.min(sz(ctx, 190), areaH / n);
    const y0 = bottom + Math.max(0, Math.min((areaH - rowH * n) / 2, sz(ctx, 40)));
    const labelW = 540;
    const valueX = M.x + 580;
    const valueW = 300;
    const pillW = anyStatus ? 240 : 0;
    const barX = valueX + valueW + 56;
    const pctW = 110;
    const barW = M.right - (anyStatus ? pillW + 48 : 0) - pctW - 16 - barX;
    const barH = sz(ctx, 18);
    list.forEach(({ o, i }, k) => {
      const y = y0 + k * rowH;
      const mid = y + rowH / 2;
      const step = reveal ? k + 1 : undefined;
      if (k > 0) boxes.push(shape({ id: `rule-${k}`, shape: 'rect', x: M.x, y: y - 1, w: M.w, h: 2, fill: colors.line, step }));

      const label = text(ctx, { id: `label-${k}`, text: field(o, 'label') || ' ', x: M.x, y: 0, w: labelW, h: rowH * 0.72, max: 40, min: 24, weight: 650, maxLines: 2, hug: true, step, bind: `metrics.${i}.label` });
      const noteValue = field(o, 'note');
      const note = noteValue ? text(ctx, { id: `note-${k}`, text: noteValue, x: M.x, y: 0, w: labelW, h: sz(ctx, 28) * 1.4, max: 26, min: 18, color: colors.muted, maxLines: 1, hug: true, step, bind: `metrics.${i}.note` }) : null;
      const labelH = label.h + (note ? 4 + note.h : 0);
      label.y = mid - labelH / 2;
      boxes.push(label);
      if (note) { note.y = label.y + label.h + 4; boxes.push(note); }

      const value = field(o, 'value');
      const target = field(o, 'target');
      const v = text(ctx, { id: `value-${k}`, text: value || ' ', x: valueX, y: 0, w: valueW, h: sz(ctx, 64) * 1.2, role: 'display', max: 64, min: 32, maxLines: 1, hug: true, align: 'right', step, bind: `metrics.${i}.value` });
      const t = target ? text(ctx, { id: `target-${k}`, text: `Target ${target}`, x: valueX, y: 0, w: valueW, h: sz(ctx, 26) * 1.35, max: 26, min: 18, color: colors.muted, maxLines: 1, hug: true, align: 'right', step, bind: `metrics.${i}.target` }) : null;
      const valueH = v.h + (t ? t.h : 0);
      v.y = mid - valueH / 2;
      boxes.push(v);
      if (t) { t.y = v.y + v.h; boxes.push(t); }

      const status = statuses[k];
      const lower = read.bool(o, 'lower');
      const p = progressOf(value, target, lower);
      if (p !== null && barW > 80) {
        const fill = status && status !== 'neutral' ? statusColor(ctx, status) : colors.accent;
        boxes.push(shape({ id: `track-${k}`, shape: 'rect', x: barX, y: mid - barH / 2, w: barW, h: barH, radius: barH / 2, fill: colors.line, step }));
        if (p > 0) boxes.push(shape({ id: `bar-${k}`, shape: 'rect', x: barX, y: mid - barH / 2, w: Math.max(barH, barW * p), h: barH, radius: barH / 2, fill, step }));
        if (!lower) {
          const pct = Math.round((toNumber(value) / toNumber(target)) * 100);
          boxes.push(text(ctx, { id: `pct-${k}`, text: `${pct}%`, x: barX + barW + 16, y: mid - sz(ctx, 30) * 0.7, w: pctW, h: sz(ctx, 30) * 1.4, max: 30, min: 20, weight: 700, color: colors.ink, maxLines: 1, valign: 'middle', step }));
        }
      }

      if (status) {
        const fill = statusColor(ctx, status);
        const ph = sz(ctx, 54);
        const px = M.right - pillW;
        boxes.push(shape({ id: `pill-${k}`, shape: 'rect', x: px, y: mid - ph / 2, w: pillW, h: ph, radius: ph / 2, fill, step }));
        boxes.push(text(ctx, { id: `status-${k}`, text: field(o, 'status'), x: px + 16, y: mid - ph / 2, w: pillW - 32, h: ph, max: 26, min: 16, weight: 700, color: inkOn(fill), align: 'center', valign: 'middle', maxLines: 1, step, bind: `metrics.${i}.status` }));
      }
    });
    return { boxes };
  },
};

// ─── Pricing ──────────────────────────────────────────────────────────

/** A plan's features, one per line, without the bullets people type. */
export function featureLines(value: string): string[] {
  return value.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•✓✔]\s*)+/, '').trim()).filter(Boolean).slice(0, 8);
}

/** Feature lines with a tick in front, all at one size: the largest that fits the area. */
function features(ctx: LayoutContext, lines: string[], a: { x: number; y: number; w: number; h: number }, o: { id: string; ink: string; tick: string; step?: number }): Box[] {
  if (!lines.length) return [];
  const max = sz(ctx, 30);
  const min = Math.min(max, sz(ctx, 20));
  const lh = 1.3;
  const indent = (s: number) => s * 1.35;
  const gap = (s: number) => s * 0.55;
  const total = (s: number) => lines.reduce((sum, l) => sum + heightAt(ctx, l, s, a.w - indent(s), 'body', lh), 0) + gap(s) * (lines.length - 1);
  let size = max;
  while (size > min && total(size) > a.h) size -= 2;
  if (total(size) > a.h) ctx.warnings.push('Text is too long to fit: a plan’s list of features. Shorten it or split the plans over two slides.');
  const boxes: Box[] = [];
  let y = a.y;
  lines.forEach((line, k) => {
    const h = Math.ceil(heightAt(ctx, line, size, a.w - indent(size), 'body', lh));
    boxes.push({
      type: 'text', id: `${o.id}-tick${k}`, x: a.x, y, w: indent(size), h: Math.ceil(size * lh), text: '✓', step: o.step,
      style: { font: 'body', size, weight: 800, color: o.tick, align: 'left', valign: 'top', lineHeight: lh },
    });
    boxes.push({
      type: 'text', id: `${o.id}-${k}`, x: a.x + indent(size), y, w: a.w - indent(size), h, text: line, step: o.step,
      style: { font: 'body', size, weight: 450, color: o.ink, align: 'left', valign: 'top', lineHeight: lh },
    });
    y += h + gap(size);
  });
  return boxes;
}

const pricing: SlideKindDefinition<C> = {
  kind: 'pricing', label: 'Pricing', description: 'One to four plans side by side, each with a price and what it includes. One can stand out as recommended.', icon: 'tag', group: 'Data',
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'plans', label: 'Plans', type: 'objects', itemLabel: 'Plan', max: 4, min: 1, fields: [
      { key: 'name', label: 'Plan', type: 'text', placeholder: 'Team' },
      { key: 'price', label: 'Price', type: 'text', placeholder: '$12' },
      { key: 'period', label: 'Per', type: 'text', placeholder: 'per seat a month' },
      { key: 'features', label: 'What it includes', type: 'textarea', rows: 4, help: 'One per line.' },
      { key: 'featured', label: 'Recommended', type: 'toggle' },
    ] },
    { key: 'badge', label: 'Label on the recommended plan', type: 'text', placeholder: 'Most popular', more: true },
    { key: 'caption', label: 'Footnote', type: 'text', placeholder: 'Prices exclude tax.', more: true },
  ],
  create: () => ({
    title: 'Plans',
    plans: [
      { name: 'Starter', price: '$0', period: 'free forever', features: 'One deck\nPowerPoint export', featured: false },
      { name: 'Team', price: '$12', period: 'per seat a month', features: 'Unlimited decks\nLive quiz\nPhones as remotes', featured: true },
      { name: 'Business', price: '$39', period: 'per seat a month', features: 'Everything in Team\nSingle sign-on\nPriority support', featured: false },
    ],
    badge: 'Most popular',
    caption: '',
  }),
  heading: (c) => read.str(c, 'title') || 'Pricing',
  text: (c) => {
    const plans = items(c, 'plans', 4);
    return [
      read.str(c, 'title'),
      ...plans.flatMap(({ o }) => [field(o, 'name'), field(o, 'price'), field(o, 'period'), ...featureLines(field(o, 'features'))]),
      plans.some(({ o }) => read.bool(o, 'featured')) ? read.str(c, 'badge') || 'Recommended' : '',
      read.str(c, 'caption'),
    ].filter((s) => s.trim());
  },
  layout(c, ctx) {
    const plans = items(c, 'plans', 4);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    if (read.objects(c, 'plans').length > 4) ctx.warnings.push('Only the first four plans fit. Move the rest to another pricing slide.');
    if (!plans.length) return { boxes };
    const colors = ctx.theme.colors;
    const caption = read.str(c, 'caption').trim();
    const capSize = sz(ctx, 26);
    const capH = caption ? Math.ceil(capSize * 1.3) + 24 : 0;
    const anyFeatured = plans.some(({ o }) => read.bool(o, 'featured'));
    const lift = anyFeatured ? sz(ctx, 24) : 0;
    const top = bottom + lift;
    const n = plans.length;
    const gap = 40;
    const colW = Math.min(n === 1 ? 760 : n === 2 ? 700 : Infinity, (M.w - gap * (n - 1)) / n);
    const x0 = M.x + (M.w - (colW * n + gap * (n - 1))) / 2;
    const cardH = M.bottom - top - capH;
    const pad = Math.round(Math.min(52, colW * 0.1));
    const badge = read.str(c, 'badge').trim() || 'Recommended';
    plans.forEach(({ o, i }, k) => {
      const featured = read.bool(o, 'featured');
      const x = x0 + k * (colW + gap);
      const y = featured ? top - lift : top;
      const h = featured ? cardH + lift : cardH;
      const ink = featured ? colors.onAccent : colors.ink;
      const w = colW - pad * 2;
      boxes.push(featured
        ? shape({ id: `plan-${k}`, shape: 'rect', x, y, w: colW, h, fill: colors.accent, radius: ctx.theme.radius, bind: `plans.${i}.features` })
        : card(ctx, `plan-${k}`, x, y, colW, h, { bind: `plans.${i}.features` }));
      let ty = y + pad;
      const parts: TextBox[] = [];
      if (featured) {
        const b = text(ctx, { id: `badge-${k}`, text: badge, x: x + pad, y: ty, w, h: sz(ctx, 24) * 1.4, max: 22, min: 16, weight: 750, tracking: 0.1, uppercase: true, color: ink, maxLines: 1, hug: true, bind: 'badge' });
        b.opacity = 0.85;
        parts.push(b);
        ty += b.h + sz(ctx, 14);
      }
      const name = text(ctx, { id: `name-${k}`, text: field(o, 'name') || ' ', x: x + pad, y: ty, w, h: sz(ctx, 42) * 1.2, role: 'display', max: 42, min: 26, maxLines: 1, hug: true, color: ink, bind: `plans.${i}.name` });
      parts.push(name);
      ty += name.h + sz(ctx, 18);
      const price = text(ctx, { id: `price-${k}`, text: field(o, 'price') || ' ', x: x + pad, y: ty, w, h: sz(ctx, 96) * 1.15, role: 'display', max: 96, min: 48, maxLines: 1, hug: true, color: featured ? colors.onAccent : colors.accent, lh: 1.08, bind: `plans.${i}.price` });
      parts.push(price);
      ty += price.h + 4;
      const periodValue = field(o, 'period');
      if (periodValue) {
        const p = text(ctx, { id: `period-${k}`, text: periodValue, x: x + pad, y: ty, w, h: sz(ctx, 26) * 1.3 * 2, max: 26, min: 18, maxLines: 2, hug: true, color: featured ? colors.onAccent : colors.muted, bind: `plans.${i}.period` });
        if (featured) p.opacity = 0.85;
        parts.push(p);
        ty += p.h;
      }
      boxes.push(...parts);
      ty += sz(ctx, 26);
      boxes.push(shape({ id: `plan-${k}-rule`, shape: 'rect', x: x + pad, y: ty, w, h: 2, fill: featured ? colors.onAccent : colors.line, opacity: featured ? 0.35 : 1 }));
      ty += sz(ctx, 28);
      boxes.push(...features(ctx, featureLines(field(o, 'features')), { x: x + pad, y: ty, w, h: y + h - pad - ty }, {
        id: `plan-${k}-f`, ink, tick: featured ? colors.onAccent : colors.accent,
      }));
    });
    if (caption) {
      boxes.push(text(ctx, { id: 'caption', text: caption, x: M.x, y: M.bottom - capH + 24, w: M.w, h: Math.ceil(capSize * 1.3), max: 26, min: 18, color: colors.muted, align: 'center', maxLines: 1, bind: 'caption' }));
    }
    return { boxes };
  },
};

// ─── Contact ──────────────────────────────────────────────────────────

/** A short name for a way to reach someone: Email, Web, Phone or Handle. Empty when it isn't clear. */
export function detailLabel(value: string): string {
  const v = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Email';
  if (/^@[\w.]+$/.test(v) || /^[\w.-]+@[\w-]+\.social$/i.test(v)) return 'Handle';
  if (/^\+?[\d\s().-]{7,}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7) return 'Phone';
  if (/^(https?:\/\/|www\.)\S+$/i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return 'Web';
  return '';
}

const contact: SlideKindDefinition<C> = {
  kind: 'contact', label: 'Contact', description: 'How to reach you: name, role, email and links, with a QR code people can scan. The last slide of a talk.', icon: 'contact', group: 'Close',
  fields: [
    { key: 'title', label: 'Title', type: 'text', placeholder: 'Thank you' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'role', label: 'Role or organisation', type: 'text' },
    { key: 'photo', label: 'Photo', type: 'image' },
    { key: 'details', label: 'Ways to reach you', type: 'list', itemLabel: 'Detail', max: 5, placeholder: 'name@example.com', help: 'An email, a website, a phone number or a handle.' },
    { key: 'link', label: 'QR code link', type: 'text', placeholder: 'https://…', help: 'Optional. People scan the code to open this link.' },
  ],
  create: () => ({
    title: 'Thank you',
    name: 'Maya Chen',
    role: 'Product lead, Lectern',
    photo: '',
    details: ['maya@example.com', 'lectern.app', '@mayachen'],
    link: '',
  }),
  heading: (c) => read.str(c, 'title') || read.str(c, 'name') || 'Contact',
  text: (c) => [read.str(c, 'title'), read.str(c, 'name'), read.str(c, 'role'), ...read.list(c, 'details')].filter(Boolean),
  layout(c, ctx) {
    const colors = ctx.theme.colors;
    const boxes: Box[] = [];
    const link = read.str(c, 'link').trim();
    const photo = imageSrc(ctx, c.photo);
    const qrSize = 500;
    const bigPhoto = photo && !link ? 520 : 0;
    const textW = link ? M.w - qrSize - 120 : bigPhoto ? M.w - bigPhoto - 120 : M.w - 200;
    const raw = Array.isArray(c.details) ? (c.details as unknown[]) : [];
    const details = raw.map((v, i) => ({ value: typeof v === 'string' ? v.trim() : '', i })).filter((d) => d.value).slice(0, 5);
    const labels = details.map((d) => detailLabel(d.value));
    const labelW = labels.some(Boolean) ? 170 : 0;

    const parts: { box: Box; gap: number }[] = [];
    const title = read.str(c, 'title');
    if (title) parts.push({ box: text(ctx, { id: 'title', text: title, x: M.x, y: 0, w: textW, h: sz(ctx, 120) * 2.3, role: 'display', max: 120, min: 64, maxLines: 2, hug: true, bind: 'title' }), gap: sz(ctx, 48) });
    // A small round photo beside the name when the QR code takes the right side.
    const smallPhoto = photo && link ? Math.round(sz(ctx, 150)) : 0;
    const nameX = M.x + (smallPhoto ? smallPhoto + 32 : 0);
    const nameW = textW - (smallPhoto ? smallPhoto + 32 : 0);
    const nameValue = read.str(c, 'name');
    const roleValue = read.str(c, 'role');
    const name = nameValue ? text(ctx, { id: 'name', text: nameValue, x: nameX, y: 0, w: nameW, h: sz(ctx, 56) * 1.25 * 2, role: 'display', max: 56, min: 36, maxLines: 2, hug: true, bind: 'name' }) : null;
    const role = roleValue ? text(ctx, { id: 'role', text: roleValue, x: nameX, y: 0, w: nameW, h: sz(ctx, 34) * 1.3 * 2, max: 34, min: 24, color: colors.muted, maxLines: 2, hug: true, bind: 'role' }) : null;
    const whoH = Math.max(smallPhoto, (name?.h ?? 0) + (name && role ? 6 : 0) + (role?.h ?? 0));
    const detailSize = sz(ctx, 36);
    const rowH = Math.ceil(detailSize * 1.5);
    const detailsH = details.length ? sz(ctx, 40) + 6 + sz(ctx, 32) + details.length * rowH : 0;
    const blockH = parts.reduce((s, p) => s + p.box.h + p.gap, 0) + whoH + detailsH;
    let y = Math.max(M.top, (CANVAS_H - blockH) / 2);
    for (const p of parts) { p.box.y = y; boxes.push(p.box); y += p.box.h + p.gap; }
    if (whoH) {
      if (smallPhoto) boxes.push({ type: 'image', id: 'photo', src: photo, x: M.x, y: y + (whoH - smallPhoto) / 2, w: smallPhoto, h: smallPhoto, fit: 'cover', radius: smallPhoto / 2, bind: 'photo' });
      let ny = y + (whoH - ((name?.h ?? 0) + (name && role ? 6 : 0) + (role?.h ?? 0))) / 2;
      if (name) { name.y = ny; boxes.push(name); ny += name.h + 6; }
      if (role) { role.y = ny; boxes.push(role); }
      y += whoH;
    }
    if (details.length) {
      y += sz(ctx, 40);
      boxes.push(shape({ id: 'rule', shape: 'rect', x: M.x, y, w: 96, h: 6, radius: 3, fill: colors.accent }));
      y += 6 + sz(ctx, 32);
      details.forEach(({ value, i }, k) => {
        const label = labels[k];
        if (label) boxes.push(text(ctx, { id: `detail-label-${k}`, text: label, x: M.x, y, w: labelW - 20, h: rowH, max: 22, min: 16, weight: 700, tracking: 0.12, uppercase: true, color: colors.muted, valign: 'middle', maxLines: 1 }));
        boxes.push(text(ctx, { id: `detail-${k}`, text: value, x: M.x + labelW, y, w: textW - labelW, h: rowH, max: 36, min: 22, weight: 550, valign: 'middle', maxLines: 1, bind: `details.${i}` }));
        y += rowH;
      });
    }
    if (link) {
      const a = { x: M.right - qrSize, y: (CANVAS_H - qrSize) / 2 - 30, w: qrSize, h: qrSize };
      boxes.push(...qrCard(ctx, link, a, 'qr', 'link'));
      boxes.push(text(ctx, { id: 'qr-label', text: displayUrl(link), x: a.x - 40, y: a.y + qrSize + 24, w: qrSize + 80, h: 48, max: 28, min: 18, scaled: false, align: 'center', maxLines: 1, weight: 700, color: colors.accent, bind: 'link' }));
    } else if (bigPhoto) {
      boxes.push({ type: 'image', id: 'photo', src: photo, x: M.right - bigPhoto, y: (CANVAS_H - bigPhoto) / 2, w: bigPhoto, h: bigPhoto, fit: 'cover', radius: bigPhoto / 2, bind: 'photo' });
    }
    return { boxes, frame: 'title' };
  },
};

export const PITCH_KINDS: AnyKind[] = [scorecard, pricing, contact];

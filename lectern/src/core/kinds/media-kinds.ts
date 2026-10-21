// Media and live slide types: video, web page, QR code, activity, timer,
// random picker and cards. Registered with the core kinds.
//
// Live content (a video, a page, an activity) is a video or embed box. Screens
// play or run it; PowerPoint gets the video itself, or a card with a link and a
// QR code; thumbnails show a still.

import { type Box, type EmbedBox, type TextBox, type VideoBox, CANVAS_H, CANVAS_W } from '../engine/boxes';
import { displayUrl, pageEmbed } from '../media/embed';
import { qrImage } from '../media/qr';
import { clock, pickerHtml, timerHtml, timerSeconds } from '../media/templates';
import { parseTime, parseVideo, videoLabel } from '../media/video';
import { M, type LayoutContext, card, read, shape, slideTitle, sz, text } from './kit';
import type { AnyKind, SlideKindDefinition } from './types';

type C = Record<string, unknown>;
type Item = Record<string, unknown>;

interface Area { x: number; y: number; w: number; h: number }

/** The largest frame of a given shape that fits the area, centred in it. */
function fitIn(a: Area, ratio = 16 / 9): Area {
  let w = a.w;
  let h = w / ratio;
  if (h > a.h) { h = a.h; w = h * ratio; }
  return { x: Math.round(a.x + (a.w - w) / 2), y: Math.round(a.y + (a.h - h) / 2), w: Math.round(w), h: Math.round(h) };
}

/** A dashed frame with a hint, shown only while editing. */
function placeholder(ctx: LayoutContext, id: string, hint: string, a: Area, bind: string): Box[] {
  if (ctx.mode !== 'edit') return [];
  return [
    shape({ id: `${id}-ph`, shape: 'rect', ...a, fill: ctx.theme.colors.surface, stroke: ctx.theme.colors.line, strokeWidth: 3, radius: ctx.theme.radius, dash: true, bind }),
    text(ctx, { id: `${id}-ph-t`, text: hint, x: a.x + 40, y: a.y + a.h / 2 - 40, w: a.w - 80, h: 80, max: 32, min: 24, color: ctx.theme.colors.muted, align: 'center', valign: 'middle', scaled: false, bind }),
  ];
}

/** An optional slide title. Returns where the content may start. */
function optionalTitle(ctx: LayoutContext, c: C, boxes: Box[]): number {
  const value = read.str(c, 'title').trim();
  if (!value) return M.top;
  const t = slideTitle(ctx, value);
  boxes.push(t.box);
  return t.bottom;
}

function caption(ctx: LayoutContext, value: string, a: Area, bind = 'caption'): TextBox {
  return text(ctx, { id: 'caption', text: value, x: a.x, y: a.y, w: a.w, h: a.h, max: 30, min: 22, color: ctx.theme.colors.muted, align: 'center', maxLines: 2, hug: true, bind });
}

function embed(ctx: LayoutContext, a: Area, o: Partial<EmbedBox> & { title: string }): EmbedBox {
  const c = ctx.theme.colors;
  return {
    type: 'embed', id: 'embed', ...a, radius: ctx.theme.radius, fill: c.surface, ink: c.ink, accent: c.accent, onAccent: c.onAccent, font: 'body', ...o,
  };
}

/** A QR code on a white card, which every phone camera reads whatever the slide colours. */
export function qrCard(ctx: LayoutContext, value: string, a: Area, id = 'qr', bind?: string): Box[] {
  const pad = Math.round(a.w * 0.06);
  return [
    shape({ id: `${id}-card`, shape: 'rect', ...a, fill: '#FFFFFF', radius: Math.min(ctx.theme.radius, 28), stroke: ctx.theme.colors.line, strokeWidth: 2, bind }),
    { type: 'image', id, src: qrImage(value, ctx.target), x: a.x + pad, y: a.y + pad, w: a.w - pad * 2, h: a.h - pad * 2, fit: 'contain', alt: `QR code for ${value}`, bind },
  ];
}

// ─── Video ────────────────────────────────────────────────────────────

const video: SlideKindDefinition<C> = {
  kind: 'video', label: 'Video', description: 'A YouTube or Vimeo link, or your own video file, playing on the slide.', icon: 'clapperboard', group: 'Media',
  variants: [{ id: 'stage', label: 'With title' }, { id: 'side', label: 'Beside text' }, { id: 'full', label: 'Full screen' }],
  fields: [
    { key: 'title', label: 'Title', type: 'text', help: 'Optional.' },
    { key: 'video', label: 'Video', type: 'video' },
    { key: 'body', label: 'Text', type: 'textarea', rows: 3, help: 'Shown beside the video. Say what to watch for.' },
    { key: 'caption', label: 'Caption or credit', type: 'text' },
    { key: 'start', label: 'Start at', type: 'text', placeholder: '1:30', help: 'Minutes and seconds into the video.', more: true },
    { key: 'autoplay', label: 'Play when the slide opens', type: 'toggle', more: true },
    { key: 'muted', label: 'Start muted', type: 'toggle', more: true },
    { key: 'loop', label: 'Play on a loop', type: 'toggle', more: true },
  ],
  create: () => ({ title: 'Watch this', video: '', body: '', caption: '', start: '', autoplay: false, muted: false, loop: false }),
  heading: (c) => read.str(c, 'title') || videoLabel(parseVideo(c.video)),
  text: (c) => [read.str(c, 'title'), read.str(c, 'body'), read.str(c, 'caption')].filter(Boolean),
  autoVariant: (c) => (read.str(c, 'body').trim() ? 'side' : read.str(c, 'title').trim() ? 'stage' : 'full'),
  layout(c, ctx, variant) {
    const src = read.str(c, 'video').trim();
    const source = parseVideo(src);
    const boxes: Box[] = [];
    const cap = read.str(c, 'caption').trim();
    const box = (a: Area, fit: 'cover' | 'contain' = 'contain', radius = ctx.theme.radius): VideoBox => ({
      type: 'video', id: 'video', ...a, src, fit, radius, bind: 'video',
      start: parseTime(read.str(c, 'start')) || undefined,
      autoplay: read.bool(c, 'autoplay'), muted: read.bool(c, 'muted'), loop: read.bool(c, 'loop'),
      title: read.str(c, 'title') || videoLabel(source), fill: '#111111', ink: '#FFFFFF',
    });
    if (variant === 'full' && source) {
      boxes.push(box({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, 'contain', 0));
      return { boxes, frame: 'bare', background: '#000000' };
    }
    if (variant === 'side') {
      const textW = 620;
      const a = fitIn({ x: M.x + textW + 80, y: M.top, w: M.right - (M.x + textW + 80), h: M.bottom - M.top - (cap ? 70 : 0) });
      const t = text(ctx, { id: 'title', text: read.str(c, 'title') || ' ', x: M.x, y: 0, w: textW, h: 300, role: 'display', max: 72, min: 46, maxLines: 3, hug: true, bind: 'title' });
      const bodyValue = read.str(c, 'body');
      const b = bodyValue ? text(ctx, { id: 'body', text: bodyValue, x: M.x, y: 0, w: textW, h: 520, max: 40, min: 28, hug: true, color: ctx.theme.colors.muted, bind: 'body' }) : null;
      let y = Math.max(M.top, (CANVAS_H - (t.h + (b ? 36 + b.h : 0))) / 2);
      t.y = y; boxes.push(t); y += t.h + 36;
      if (b) { b.y = y; boxes.push(b); }
      boxes.push(...(source ? [box(a)] : placeholder(ctx, 'video', 'Add a video: paste a link or upload a file', a, 'video')));
      if (cap) boxes.push(caption(ctx, cap, { x: a.x, y: a.y + a.h + 18, w: a.w, h: 60 }));
      return { boxes };
    }
    const top = optionalTitle(ctx, c, boxes);
    const a = fitIn({ x: M.x, y: top, w: M.w, h: M.bottom - top - (cap ? 70 : 0) });
    boxes.push(...(source ? [box(a)] : placeholder(ctx, 'video', 'Add a video: paste a YouTube or Vimeo link, or upload a file', a, 'video')));
    if (cap) boxes.push(caption(ctx, cap, { x: M.x, y: a.y + a.h + 18, w: M.w, h: 60 }));
    return { boxes };
  },
};

// ─── Web page ─────────────────────────────────────────────────────────

const web: SlideKindDefinition<C> = {
  kind: 'web', label: 'Web page', description: 'A live website or app on the slide: a simulation, a map, a form or a shared document.', icon: 'globe', group: 'Media',
  variants: [{ id: 'stage', label: 'With title' }, { id: 'full', label: 'Full screen' }],
  fields: [
    { key: 'title', label: 'Title', type: 'text', help: 'Optional.' },
    { key: 'url', label: 'Address', type: 'text', placeholder: 'https://…', help: 'Google Slides, Docs and Forms, Figma, GeoGebra, CodePen, Canva and Miro links are converted for you. Some sites refuse to show inside other pages; an Open button covers those.' },
    { key: 'qr', label: 'Show a QR code to open it on phones', type: 'toggle' },
    { key: 'caption', label: 'Caption', type: 'text', more: true },
  ],
  create: () => ({ title: '', url: '', qr: false, caption: '' }),
  heading: (c) => read.str(c, 'title') || (pageEmbed(c.url)?.site ?? 'Web page'),
  text: (c) => [read.str(c, 'title'), read.str(c, 'caption')].filter(Boolean),
  autoVariant: (c) => (read.str(c, 'title').trim() || read.bool(c, 'qr') ? 'stage' : 'full'),
  layout(c, ctx, variant) {
    const page = pageEmbed(c.url);
    const boxes: Box[] = [];
    const title = read.str(c, 'title') || page?.site || 'Web page';
    if (variant === 'full' && page) {
      boxes.push(embed(ctx, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, { url: page.src, openUrl: page.open, title, radius: 0, icon: 'globe' }));
      return { boxes, frame: 'bare' };
    }
    const top = optionalTitle(ctx, c, boxes);
    const cap = read.str(c, 'caption').trim();
    const qr = read.bool(c, 'qr') && page ? 300 : 0;
    const a: Area = { x: M.x, y: top, w: M.w - (qr ? qr + 56 : 0), h: M.bottom - top - (cap ? 70 : 0) };
    if (page) boxes.push(embed(ctx, a, { url: page.src, openUrl: page.open, title, icon: 'globe', bind: 'url' }));
    else boxes.push(...placeholder(ctx, 'web', 'Add the address of a page on the right', a, 'url'));
    if (qr && page) {
      const q: Area = { x: M.right - qr, y: a.y + Math.max(0, (a.h - qr - 90) / 2), w: qr, h: qr };
      boxes.push(...qrCard(ctx, page.open, q, 'qr', 'qr'));
      boxes.push(text(ctx, { id: 'qr-label', text: displayUrl(page.open), x: q.x - 20, y: q.y + qr + 20, w: qr + 40, h: 70, max: 22, min: 16, scaled: false, align: 'center', maxLines: 2, color: ctx.theme.colors.muted, hug: true }));
    }
    if (cap) boxes.push(caption(ctx, cap, { x: a.x, y: a.y + a.h + 18, w: a.w, h: 60 }));
    return { boxes };
  },
};

// ─── QR code ──────────────────────────────────────────────────────────

const qr: SlideKindDefinition<C> = {
  kind: 'qr', label: 'QR code', description: 'A big QR code for a link: a survey, a sign-up, the slides or resources to take away.', icon: 'qr-code', group: 'Engage',
  variants: [{ id: 'side', label: 'Beside text' }, { id: 'center', label: 'Centred' }],
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    { key: 'url', label: 'Link', type: 'text', placeholder: 'https://…', help: 'Any web address, or plain text up to about 900 characters.' },
    { key: 'body', label: 'Text', type: 'textarea', rows: 3, help: 'Optional. What people get when they scan.' },
    { key: 'showLink', label: 'Show the link under the code', type: 'toggle' },
  ],
  create: () => ({ title: 'Scan to join in', url: '', body: 'Point your phone camera at the code.', showLink: true }),
  heading: (c) => read.str(c, 'title') || 'QR code',
  text: (c) => [read.str(c, 'title'), read.str(c, 'body')].filter(Boolean),
  autoVariant: (c) => (read.str(c, 'body').trim() ? 'side' : 'center'),
  layout(c, ctx, variant) {
    const value = read.str(c, 'url').trim();
    const link = read.bool(c, 'showLink') && value ? displayUrl(value) : '';
    const boxes: Box[] = [];
    if (variant === 'center') {
      const top = optionalTitle(ctx, c, boxes);
      boxes.forEach((b) => { if (b.type === 'text') b.style.align = 'center'; });
      const size = Math.min(620, M.bottom - top - (link ? 90 : 20));
      const a: Area = { x: (CANVAS_W - size) / 2, y: top, w: size, h: size };
      boxes.push(...(value ? qrCard(ctx, value, a, 'qr', 'url') : placeholder(ctx, 'qr', 'Add a link', a, 'url')));
      if (link) boxes.push(text(ctx, { id: 'link', text: link, x: M.x, y: a.y + size + 24, w: M.w, h: 60, max: 34, min: 24, align: 'center', maxLines: 1, color: ctx.theme.colors.accent, weight: 700, bind: 'url' }));
      return { boxes };
    }
    const size = 640;
    const a: Area = { x: M.right - size, y: (CANVAS_H - size) / 2 - (link ? 30 : 0), w: size, h: size };
    const textW = M.w - size - 120;
    const t = text(ctx, { id: 'title', text: read.str(c, 'title') || ' ', x: M.x, y: 0, w: textW, h: 360, role: 'display', max: 84, min: 50, maxLines: 3, hug: true, bind: 'title' });
    const bodyValue = read.str(c, 'body');
    const b = bodyValue ? text(ctx, { id: 'body', text: bodyValue, x: M.x, y: 0, w: textW, h: 400, max: 42, min: 28, hug: true, color: ctx.theme.colors.muted, bind: 'body' }) : null;
    let y = Math.max(M.top, (CANVAS_H - (t.h + (b ? 40 + b.h : 0))) / 2);
    t.y = y; boxes.push(t); y += t.h + 40;
    if (b) { b.y = y; boxes.push(b); }
    boxes.push(...(value ? qrCard(ctx, value, a, 'qr', 'url') : placeholder(ctx, 'qr', 'Add a link', a, 'url')));
    if (link) boxes.push(text(ctx, { id: 'link', text: link, x: a.x - 40, y: a.y + size + 24, w: size + 80, h: 50, max: 28, min: 20, align: 'center', maxLines: 1, color: ctx.theme.colors.accent, weight: 700, bind: 'url' }));
    return { boxes };
  },
};

// ─── Activity ─────────────────────────────────────────────────────────

const activity: SlideKindDefinition<C> = {
  kind: 'activity', label: 'Activity', description: 'A game, quiz or simulation that runs on the slide. Describe it and AI builds it, or paste your own HTML.', icon: 'gamepad-2', group: 'Engage',
  variants: [{ id: 'stage', label: 'With title' }, { id: 'full', label: 'Full screen' }],
  fields: [
    { key: 'title', label: 'Title', type: 'text', help: 'Optional.' },
    {
      key: 'prompt', label: 'What to build', type: 'activity', htmlKey: 'html',
      placeholder: 'A drag-and-drop game: sort eight animals into mammals, birds and fish, with a score',
    },
    { key: 'caption', label: 'Instructions', type: 'text', help: 'Optional. One line under the activity, like “Tap a card to flip it”.' },
  ],
  create: () => ({ title: '', prompt: '', html: '', caption: '' }),
  heading: (c) => read.str(c, 'title') || read.str(c, 'prompt').split(/[.:\n]/)[0].slice(0, 60) || 'Activity',
  text: (c) => [read.str(c, 'title'), read.str(c, 'caption')].filter(Boolean),
  autoVariant: (c) => (read.str(c, 'title').trim() || read.str(c, 'caption').trim() ? 'stage' : 'full'),
  layout(c, ctx, variant) {
    const html = read.str(c, 'html').trim();
    const prompt = read.str(c, 'prompt').trim();
    const title = read.str(c, 'title') || 'Activity';
    const boxes: Box[] = [];
    if (variant === 'full' && html) {
      boxes.push(embed(ctx, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, { html, title, radius: 0, icon: 'gamepad-2', fill: ctx.theme.colors.bg }));
      return { boxes, frame: 'bare' };
    }
    const top = optionalTitle(ctx, c, boxes);
    const cap = read.str(c, 'caption').trim();
    const a: Area = { x: M.x, y: top, w: M.w, h: M.bottom - top - (cap ? 70 : 0) };
    if (html) {
      boxes.push(embed(ctx, a, { html, title, icon: 'gamepad-2', bind: 'prompt' }));
    } else if (ctx.mode === 'edit') {
      boxes.push(...placeholder(ctx, 'activity', prompt ? 'Press Build on the right to make this activity' : 'Describe a game, quiz or simulation on the right, and AI builds it', a, 'prompt'));
    } else if (prompt) {
      boxes.push(card(ctx, 'activity-card', a.x, a.y, a.w, a.h));
      boxes.push(text(ctx, { id: 'activity-prompt', text: prompt, x: a.x + 80, y: a.y + 60, w: a.w - 160, h: a.h - 120, max: 44, min: 28, valign: 'middle', align: 'center', color: ctx.theme.colors.muted }));
    }
    if (cap) boxes.push(caption(ctx, cap, { x: a.x, y: a.y + a.h + 18, w: a.w, h: 60 }));
    return { boxes };
  },
};

// ─── Timer ────────────────────────────────────────────────────────────

const timer: SlideKindDefinition<C> = {
  kind: 'timer', label: 'Timer', description: 'A big countdown for a task, a break or a discussion, with a chime at the end.', icon: 'timer', group: 'Engage',
  fields: [
    { key: 'title', label: 'Task', type: 'textarea', rows: 2, placeholder: 'Talk it over with a partner' },
    { key: 'minutes', label: 'Time', type: 'text', placeholder: '5', help: 'Minutes, or minutes and seconds like 2:30.' },
    { key: 'autostart', label: 'Start when the slide opens', type: 'toggle' },
    { key: 'sound', label: 'Chime at the end', type: 'toggle' },
  ],
  create: () => ({ title: 'Talk it over with a partner', minutes: '3', autostart: false, sound: true }),
  heading: (c) => read.str(c, 'title') || `${clock(timerSeconds(c.minutes))} timer`,
  text: (c) => [read.str(c, 'title')].filter(Boolean),
  layout(c, ctx) {
    const seconds = timerSeconds(c.minutes);
    const boxes: Box[] = [];
    const top = optionalTitle(ctx, c, boxes);
    const a: Area = { x: M.x, y: top, w: M.w, h: M.bottom - top };
    if (ctx.target === 'pptx') {
      // PowerPoint can't run the timer; it shows the time to set.
      boxes.push(text(ctx, { id: 'time', text: clock(seconds), x: a.x, y: a.y, w: a.w, h: a.h, role: 'display', max: 300, min: 120, align: 'center', valign: 'middle', color: ctx.theme.colors.accent, bind: 'minutes' }));
      return { boxes };
    }
    boxes.push(embed(ctx, a, {
      html: timerHtml(ctx.theme, { seconds, autostart: read.bool(c, 'autostart'), sound: read.bool(c, 'sound') }),
      title: `${clock(seconds)} timer`, icon: 'timer', fill: ctx.theme.colors.bg, bind: 'minutes',
    }));
    return { boxes };
  },
};

// ─── Random picker ────────────────────────────────────────────────────

const picker: SlideKindDefinition<C> = {
  kind: 'picker', label: 'Random picker', description: 'Spin a wheel to pick a name, a question or a topic at random.', icon: 'dices', group: 'Engage',
  fields: [
    { key: 'title', label: 'Title', type: 'text', help: 'Optional.' },
    { key: 'items', label: 'On the wheel', type: 'list', itemLabel: 'Choice', max: 40, help: 'Press Enter for the next one.' },
    { key: 'removePicked', label: 'Take each pick off the wheel', type: 'toggle' },
  ],
  create: () => ({ title: 'Who goes next?', items: ['Team A', 'Team B', 'Team C', 'Team D'], removePicked: false }),
  heading: (c) => read.str(c, 'title') || 'Random picker',
  text: (c) => [read.str(c, 'title')].filter(Boolean),
  layout(c, ctx) {
    const items = read.list(c, 'items');
    const boxes: Box[] = [];
    const top = optionalTitle(ctx, c, boxes);
    const a: Area = { x: M.x, y: top, w: M.w, h: M.bottom - top };
    if (ctx.target === 'pptx' || !items.length) {
      if (!items.length && ctx.mode === 'edit') return { boxes: [...boxes, ...placeholder(ctx, 'picker', 'Add choices on the right', a, 'items')] };
      // PowerPoint gets the choices as a list.
      const cols = items.length > 8 ? 2 : 1;
      const per = Math.ceil(items.length / cols);
      for (let k = 0; k < cols; k++) {
        const part = items.slice(k * per, (k + 1) * per);
        const w = (a.w - 80 * (cols - 1)) / cols;
        part.forEach((item, j) => {
          boxes.push(text(ctx, { id: `item-${k * per + j}`, text: `• ${item}`, x: a.x + k * (w + 80), y: a.y + j * sz(ctx, 64), w, h: sz(ctx, 60), max: 40, min: 24, maxLines: 1, bind: `items.${k * per + j}` }));
        });
      }
      return { boxes };
    }
    boxes.push(embed(ctx, a, {
      html: pickerHtml(ctx.theme, { items, removePicked: read.bool(c, 'removePicked') }),
      title: 'Random picker', icon: 'dices', fill: ctx.theme.colors.bg, bind: 'items',
    }));
    return { boxes };
  },
};

// ─── Cards ────────────────────────────────────────────────────────────

function cardItems(c: C) {
  return read.objects<Item>(c, 'cards')
    .map((o, i) => ({ icon: String(o.icon ?? '').trim(), heading: String(o.heading ?? '').trim(), body: String(o.text ?? '').trim(), i }))
    .filter((o) => o.icon || o.heading || o.body)
    .slice(0, 6);
}

const cards: SlideKindDefinition<C> = {
  kind: 'cards', label: 'Cards', description: 'Two to six cards, each with an emoji, a heading and a line: features, options, ideas or rules.', icon: 'layout-dashboard', group: 'Explain',
  variants: [{ id: 'row', label: 'In a row' }, { id: 'grid', label: 'Grid' }],
  fields: [
    { key: 'title', label: 'Title', type: 'textarea', rows: 2 },
    {
      key: 'cards', label: 'Cards', type: 'objects', itemLabel: 'Card', min: 1, max: 6,
      fields: [
        { key: 'icon', label: 'Emoji or symbol', type: 'text', placeholder: '⚡' },
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'text', label: 'Text', type: 'textarea', rows: 2 },
      ],
    },
    { key: 'reveal', label: 'Reveal cards one at a time', type: 'toggle' },
  ],
  create: () => ({
    title: 'Why it works',
    cards: [
      { icon: '⚡', heading: 'Fast', text: 'Ready in seconds, not hours.' },
      { icon: '🔒', heading: 'Private', text: 'Your work stays on your device.' },
      { icon: '🌍', heading: 'Anywhere', text: 'Works offline and on any screen.' },
    ],
    reveal: false,
  }),
  heading: (c) => read.str(c, 'title') || 'Cards',
  text: (c) => [read.str(c, 'title'), ...cardItems(c).flatMap((o) => [o.heading, o.body])].filter(Boolean),
  autoVariant: (c) => (cardItems(c).length >= 4 ? 'grid' : 'row'),
  layout(c, ctx, variant) {
    const items = cardItems(c);
    const boxes: Box[] = [];
    const t = slideTitle(ctx, read.str(c, 'title'));
    boxes.push(t.box);
    if (!items.length) return { boxes };
    const n = items.length;
    const grid = variant === 'grid' && n > 2;
    const cols = grid ? (n <= 4 ? 2 : 3) : n;
    const rows = Math.ceil(n / cols);
    const gap = sz(ctx, 36);
    const area: Area = { x: M.x, y: t.bottom, w: M.w, h: M.bottom - t.bottom };
    const w = (area.w - gap * (cols - 1)) / cols;
    const h = Math.min((area.h - gap * (rows - 1)) / rows, grid ? 400 : 560);
    const reveal = read.bool(c, 'reveal');
    const pad = Math.round(Math.min(w, h) * 0.1);
    const colors = ctx.theme.colors;
    items.forEach((item, k) => {
      const x = area.x + (k % cols) * (w + gap);
      const y = area.y + Math.floor(k / cols) * (h + gap);
      const step = reveal ? k + 1 : undefined;
      boxes.push({ ...card(ctx, `card-${k}`, x, y, w, h), step });
      const horizontal = grid && w > h * 1.4;
      const d = Math.round(Math.min(sz(ctx, 108), h * (horizontal ? 0.42 : 0.3)));
      let tx = x + pad;
      let ty = y + pad;
      let tw = w - pad * 2;
      if (item.icon) {
        boxes.push(shape({ id: `card-${k}-dot`, shape: 'ellipse', x: tx, y: ty, w: d, h: d, fill: colors.accent2, step }));
        boxes.push({
          type: 'text', id: `card-${k}-icon`, x: tx, y: ty, w: d, h: d, text: item.icon, step, bind: `cards.${item.i}.icon`,
          style: { font: 'body', size: Math.round(d * 0.5), weight: 400, color: colors.ink, align: 'center', valign: 'middle', lineHeight: 1 },
        });
        if (horizontal) { tx += d + pad * 0.8; tw -= d + pad * 0.8; } else ty += d + sz(ctx, 24);
      }
      const room = y + h - pad - ty;
      const head = item.heading ? text(ctx, { id: `card-${k}-h`, text: item.heading, x: tx, y: ty, w: tw, h: Math.min(room, sz(ctx, 52) * 2.3), role: 'display', max: 46, min: 28, maxLines: 2, hug: true, step, bind: `cards.${item.i}.heading` }) : null;
      if (head) { boxes.push(head); ty += head.h + sz(ctx, 12); }
      if (item.body) {
        boxes.push(text(ctx, { id: `card-${k}-t`, text: item.body, x: tx, y: ty, w: tw, h: Math.max(40, y + h - pad - ty), max: 30, min: 20, color: colors.muted, hug: true, step, bind: `cards.${item.i}.text` }));
      }
    });
    const used = rows * h + gap * (rows - 1);
    if (used < area.h) {
      const shift = Math.min((area.h - used) / 2, sz(ctx, 60));
      boxes.forEach((b) => { if (b.id !== 'title') b.y += shift; });
    }
    return { boxes };
  },
};

export const MEDIA_KINDS: AnyKind[] = [video, web, qr, activity, timer, picker, cards];


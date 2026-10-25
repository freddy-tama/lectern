// Draws a laid-out slide onto a canvas so the in-app AI agent can SEE it: one slide as a
// compact JPEG, or many slides tiled into a numbered contact sheet. It follows SlideView
// box by box (text wrapping, overflow, pictures, charts, tables), so what the AI judges is
// what the presenter sees. Nothing here throws; where there is no 2D canvas it returns null.

import { type Box, CANVAS_H, CANVAS_W, type ChartBox, type EmbedBox, type ImageBox, type ShapeBox, type SlideLayout, type TableBox, type TextBox, type VideoBox } from '../../core/engine/boxes';
import { cssFont, wrapLines } from '../../core/engine/measure';
import { type Theme, fontFamily } from '../../core/engine/themes';
import { assetUrl } from '../../data/repo';

/** A picture for the AI: base64 JPEG without the data: prefix. */
export interface SlideShot {
  data: string;
  mime: 'image/jpeg';
  width: number;
  height: number;
}

type Ctx = CanvasRenderingContext2D;

/** Widest a contact sheet gets, in px, and the tallest (canvases fail past a few thousand). */
const SHEET_MAX_W = 1600;
const SHEET_MAX_H = 6000;
const SHEET_GAP = 12;
const SHEET_PAD = 12;
/** A strip above each tile for its label, so the label never covers the slide. */
const SHEET_LABEL = 30;
const SHEET_BG = '#d4d4d8';
const IMAGE_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Pure helpers

/** Where an image of `srcW` × `srcH` lands inside a `boxW` × `boxH` frame (frame-relative). */
export function fitRect(srcW: number, srcH: number, boxW: number, boxH: number, fit: 'cover' | 'contain') {
  if (srcW <= 0 || srcH <= 0 || boxW <= 0 || boxH <= 0) return { dx: 0, dy: 0, dw: boxW, dh: boxH };
  const scale = fit === 'cover' ? Math.max(boxW / srcW, boxH / srcH) : Math.min(boxW / srcW, boxH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (boxW - dw) / 2, dy: (boxH - dh) / 2, dw, dh };
}

export interface SheetGrid {
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  width: number;
  height: number;
  /** Top-left of each tile, in order. */
  cells: { x: number; y: number }[];
}

/** Grid for `count` 16:9 tiles. The tile width shrinks so the sheet stays within the size caps. */
export function sheetGrid(count: number, cols = 3, tileWidth = 480, maxW = SHEET_MAX_W, maxH = SHEET_MAX_H): SheetGrid {
  const n = Math.max(0, Math.floor(count));
  const c = Math.max(1, Math.min(Math.floor(cols) || 1, Math.max(1, n)));
  const rows = Math.ceil(n / c) || 0;
  const byWidth = (maxW - 2 * SHEET_PAD - (c - 1) * SHEET_GAP) / c;
  const byHeight = rows ? ((maxH - 2 * SHEET_PAD - (rows - 1) * SHEET_GAP - rows * SHEET_LABEL) / rows) * (16 / 9) : tileWidth;
  const tileW = Math.max(32, Math.floor(Math.min(tileWidth, byWidth, byHeight)));
  const tileH = Math.round((tileW * 9) / 16);
  const cells = Array.from({ length: n }, (_, i) => ({
    x: SHEET_PAD + (i % c) * (tileW + SHEET_GAP),
    y: SHEET_PAD + SHEET_LABEL + Math.floor(i / c) * (tileH + SHEET_LABEL + SHEET_GAP),
  }));
  return {
    cols: c, rows, tileW, tileH, cells,
    width: 2 * SHEET_PAD + c * tileW + (c - 1) * SHEET_GAP,
    height: 2 * SHEET_PAD + rows * (tileH + SHEET_LABEL) + Math.max(0, rows - 1) * SHEET_GAP,
  };
}

/** Vertical start of a text block of `total` px inside a box of height `h`. */
export function blockTop(valign: 'top' | 'middle' | 'bottom' | undefined, h: number, total: number): number {
  return valign === 'middle' ? (h - total) / 2 : valign === 'bottom' ? h - total : 0;
}

// ---------------------------------------------------------------------------
// Canvas plumbing

function newCanvas(w: number, h: number): HTMLCanvasElement | null {
  try {
    if (typeof document === 'undefined') return null;
    // jsdom has no canvas and logs a "not implemented" error on every getContext call.
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return canvas.getContext('2d') ? canvas : null;
  } catch {
    return null;
  }
}

function roundedPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (radius <= 0) ctx.rect(x, y, w, h);
  else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

function setSpacing(ctx: Ctx, px: number) {
  (ctx as unknown as { letterSpacing?: string }).letterSpacing = `${px}px`;
}

/** Loads fonts the slide uses, then waits for any others in flight. */
async function fontsReady(fonts: string[]) {
  try {
    const set = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!set) return;
    await Promise.all(fonts.map((f) => set.load(f).catch(() => [])));
    await set.ready;
  } catch {
    // Fonts that cannot be waited for are drawn with whatever the browser has.
  }
}

type ImageCache = Map<string, Promise<HTMLImageElement | null>>;

function loadUrl(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (value: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), IMAGE_TIMEOUT_MS);
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

function loadImage(src: string, cache: ImageCache): Promise<HTMLImageElement | null> {
  let hit = cache.get(src);
  if (!hit) {
    hit = (async () => {
      try {
        const url = src.startsWith('asset:') ? await assetUrl(src) : src;
        return url ? await loadUrl(url) : null;
      } catch {
        return null;
      }
    })();
    cache.set(src, hit);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Boxes

function drawText(ctx: Ctx, box: TextBox, theme: Theme, marks: boolean, scale: number) {
  const s = box.style;
  const size = s.size;
  const font = cssFont(fontFamily(theme, s.font, 'web'), size, s.weight, s.italic);
  const lh = (s.lineHeight ?? 1.3) * size;
  ctx.font = font;
  setSpacing(ctx, (s.tracking ?? 0) * size);
  // Wrap with the same font and spacing the lines are drawn with, as CSS does.
  const measure = (t: string, f: string) => { ctx.font = f; return ctx.measureText(t).width; };
  const text = s.uppercase ? box.text.toUpperCase() : box.text;
  const lines = wrapLines(text, box.w, font, measure);
  const top = box.y + blockTop(s.valign, box.h, lines.length * lh);
  const align = s.align ?? 'left';
  ctx.fillStyle = s.color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
  const m = ctx.measureText('Mg');
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  const hasMetrics = Number.isFinite(asc) && Number.isFinite(desc) && asc + desc > 0;
  lines.forEach((line, i) => {
    if (!line) return;
    const centre = top + i * lh + lh / 2;
    ctx.textBaseline = hasMetrics ? 'alphabetic' : 'middle';
    ctx.fillText(line, x, hasMetrics ? centre - (asc + desc) / 2 + asc : centre);
  });
  setSpacing(ctx, 0);
  if (marks && box.overflow) {
    ctx.save();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = Math.max(4, 1.5 / scale);
    ctx.setLineDash([16, 10]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }
}

function drawShape(ctx: Ctx, box: ShapeBox, theme: Theme) {
  const sw = box.strokeWidth ?? 2;
  if (box.shape === 'line') {
    ctx.strokeStyle = box.stroke ?? theme.colors.line;
    ctx.lineWidth = sw;
    ctx.setLineDash(box.dash ? [sw * 3, sw * 2] : []);
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + sw / 2);
    ctx.lineTo(box.x + box.w, box.y + sw / 2);
    ctx.stroke();
    return;
  }
  const path = () => {
    if (box.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
    } else roundedPath(ctx, box.x, box.y, box.w, box.h, box.radius ?? 0);
  };
  if (box.fill) {
    ctx.fillStyle = box.fill;
    path();
    ctx.fill();
  }
  if (box.stroke && (box.dash || box.strokeWidth)) {
    ctx.save();
    if (box.dash) {
      // An outline drawn just inside the edge.
      ctx.strokeStyle = box.stroke;
      ctx.lineWidth = sw;
      ctx.setLineDash([sw * 3, sw * 2]);
      ctx.beginPath();
      if (box.shape === 'ellipse') ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, Math.max(0, box.w / 2 - sw / 2), Math.max(0, box.h / 2 - sw / 2), 0, 0, Math.PI * 2);
      else roundedPath(ctx, box.x + sw / 2, box.y + sw / 2, box.w - sw, box.h - sw, Math.max(0, (box.radius ?? 0) - sw / 2));
      ctx.stroke();
    } else {
      // An inset stroke: a double-width line clipped to the shape.
      path();
      ctx.clip();
      path();
      ctx.strokeStyle = box.stroke;
      ctx.lineWidth = sw * 2;
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** A small picture-frame icon: a sun and two hills. */
function drawMountains(ctx: Ctx, cx: number, cy: number, size: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  const s = size / 2;
  ctx.beginPath();
  ctx.arc(cx + s * 0.5, cy - s * 0.45, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s * 0.7);
  ctx.lineTo(cx - s * 0.3, cy - s * 0.2);
  ctx.lineTo(cx + s * 0.15, cy + s * 0.4);
  ctx.lineTo(cx + s * 0.4, cy + s * 0.05);
  ctx.lineTo(cx + s, cy + s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPlaceholder(ctx: Ctx, box: Box, radius: number, empty: boolean) {
  ctx.save();
  roundedPath(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.fillStyle = empty ? '#f4f4f5' : '#e4e4e7';
  ctx.fill();
  if (empty) {
    ctx.strokeStyle = '#a1a1aa';
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 10]);
    roundedPath(ctx, box.x + 2, box.y + 2, box.w - 4, box.h - 4, radius);
    ctx.stroke();
  }
  drawMountains(ctx, box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) * 0.3, '#a1a1aa');
  ctx.restore();
}

async function drawImageBox(ctx: Ctx, box: ImageBox, marks: boolean, cache: ImageCache) {
  const radius = box.radius ?? 0;
  if (!box.src) {
    if (marks) drawPlaceholder(ctx, box, radius, true);
    return;
  }
  const img = await loadImage(box.src, cache);
  if (!img) {
    drawPlaceholder(ctx, box, radius, false);
    return;
  }
  const sw = img.naturalWidth || img.width || box.w;
  const sh = img.naturalHeight || img.height || box.h;
  const r = fitRect(sw, sh, box.w, box.h, box.fit);
  ctx.save();
  roundedPath(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.clip();
  ctx.drawImage(img, box.x + r.dx, box.y + r.dy, r.dw, r.dh);
  ctx.restore();
}

async function drawChart(ctx: Ctx, box: ChartBox, theme: Theme) {
  try {
    const [{ renderToStaticMarkup }, { createElement }, { ChartView }] = await Promise.all([import('react-dom/server'), import('react'), import('./ChartView')]);
    const markup = renderToStaticMarkup(createElement(ChartView, { box, theme }));
    const svg = markup.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = await loadUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    if (!img) throw new Error('chart did not load');
    ctx.drawImage(img, box.x, box.y, box.w, box.h);
  } catch {
    ctx.save();
    ctx.fillStyle = '#f4f4f5';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = '#71717a';
    ctx.font = cssFont(fontFamily(theme, 'body', 'web'), Math.min(48, box.h / 4), 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Chart', box.x + box.w / 2, box.y + box.h / 2);
    ctx.restore();
  }
}

function drawTable(ctx: Ctx, box: TableBox, theme: Theme) {
  const padX = box.padX ?? Math.round(box.fontSize * 0.65);
  const padY = box.padY ?? Math.round(box.fontSize * 0.42);
  const family = fontFamily(theme, box.font, 'web');
  const lh = (box.lineHeight ?? 1.25) * box.fontSize;
  const measure = (t: string, f: string) => { ctx.font = f; return ctx.measureText(t).width; };
  let y = box.y;
  box.rows.forEach((row, i) => {
    const h = box.rowHeights[i] ?? 0;
    const head = box.header && i === 0;
    const bodyIndex = box.header ? i - 1 : i;
    const fill = head ? box.headerFill : box.stripeFill && bodyIndex % 2 === 1 ? box.stripeFill : undefined;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(box.x, y, box.w, h);
    }
    let x = box.x;
    row.forEach((cell, j) => {
      const w = box.colWidths[j] ?? 0;
      const align = box.align?.[j] ?? 'left';
      const font = cssFont(family, box.fontSize, head ? box.headerWeight ?? 700 : box.weight ?? 400);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.font = font;
      ctx.fillStyle = head ? box.headerText : box.textColor;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      const lines = wrapLines(cell, Math.max(1, w - 2 * padX), font, measure);
      const top = y + padY + blockTop('middle', h - 2 * padY, lines.length * lh);
      const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - padX : x + padX;
      lines.forEach((line, k) => { if (line) ctx.fillText(line, tx, top + k * lh + lh / 2); });
      ctx.restore();
      x += w;
    });
    y += h;
    if (!head) {
      ctx.fillStyle = box.lineColor;
      ctx.fillRect(box.x, y - 1, box.w, 2);
    }
  });
}

function drawPlay(ctx: Ctx, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  const t = size * 0.21;
  ctx.beginPath();
  ctx.moveTo(cx - t * 0.7, cy - t * 1.1);
  ctx.lineTo(cx + t * 1.2, cy);
  ctx.lineTo(cx - t * 0.7, cy + t * 1.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCaption(ctx: Ctx, text: string, cx: number, y: number, maxW: number, size: number, weight: number, color: string, theme: Theme, role: 'display' | 'body' | 'mono') {
  const font = cssFont(fontFamily(theme, role, 'web'), size, weight);
  const measure = (t: string, f: string) => { ctx.font = f; return ctx.measureText(t).width; };
  const lines = wrapLines(text, maxW, font, measure).slice(0, 3);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, cx, y + i * size * 1.3));
  return lines.length * size * 1.3;
}

function drawVideo(ctx: Ctx, box: VideoBox, theme: Theme) {
  ctx.save();
  roundedPath(ctx, box.x, box.y, box.w, box.h, box.radius ?? 0);
  ctx.fillStyle = box.fill;
  ctx.fill();
  ctx.clip();
  const badge = Math.round(Math.min(box.w, box.h) * 0.18);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2 - (box.title ? badge * 0.3 : 0);
  drawPlay(ctx, cx, cy, badge);
  if (box.title) drawCaption(ctx, box.title, cx, cy + badge * 0.85, box.w * 0.8, Math.max(24, badge * 0.3), 600, box.ink, theme, 'body');
  ctx.restore();
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function drawEmbed(ctx: Ctx, box: EmbedBox, theme: Theme) {
  ctx.save();
  roundedPath(ctx, box.x, box.y, box.w, box.h, box.radius ?? 0);
  ctx.fillStyle = box.fill;
  ctx.fill();
  ctx.clip();
  const icon = Math.round(Math.min(box.w, box.h) * 0.16);
  const tile = icon * 1.7;
  const cx = box.x + box.w / 2;
  const role = box.font ?? 'body';
  const titleSize = Math.max(28, icon * 0.42);
  const detail = box.url ? hostOf(box.openUrl || box.url) : box.html ? 'Interactive · runs when you present' : '';
  const total = tile + (box.title ? 18 + titleSize * 1.3 : 0) + (detail ? 18 + 22 * 1.3 : 0);
  let y = box.y + (box.h - total) / 2;
  roundedPath(ctx, cx - tile / 2, y, tile, tile, tile * 0.28);
  ctx.fillStyle = box.accent;
  ctx.fill();
  // A globe: ring, equator and meridian.
  ctx.strokeStyle = box.onAccent;
  ctx.lineWidth = Math.max(3, icon * 0.08);
  ctx.beginPath();
  ctx.arc(cx, y + tile / 2, icon * 0.4, 0, Math.PI * 2);
  ctx.moveTo(cx - icon * 0.4, y + tile / 2);
  ctx.lineTo(cx + icon * 0.4, y + tile / 2);
  ctx.moveTo(cx, y + tile / 2 - icon * 0.4);
  ctx.lineTo(cx, y + tile / 2 + icon * 0.4);
  ctx.stroke();
  y += tile + 18;
  if (box.title) y += drawCaption(ctx, box.title, cx, y + titleSize * 0.65, box.w - 96, titleSize, 700, box.ink, theme, role) + 18;
  if (detail) drawCaption(ctx, detail, cx, y + 14, box.w - 96, Math.max(22, icon * 0.3), 400, box.ink, theme, role);
  ctx.restore();
}

async function drawBox(ctx: Ctx, box: Box, theme: Theme, marks: boolean, scale: number, cache: ImageCache) {
  ctx.save();
  try {
    ctx.globalAlpha = box.opacity ?? 1;
    ctx.setLineDash([]);
    switch (box.type) {
      case 'text': drawText(ctx, box, theme, marks, scale); break;
      case 'shape': drawShape(ctx, box, theme); break;
      case 'image': await drawImageBox(ctx, box, marks, cache); break;
      case 'chart': await drawChart(ctx, box, theme); break;
      case 'table': drawTable(ctx, box, theme); break;
      case 'video': drawVideo(ctx, box, theme); break;
      case 'embed': drawEmbed(ctx, box, theme); break;
    }
  } catch {
    // One bad box never stops the slide.
  } finally {
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Exports

/** Draws a laid-out slide at `width` px wide (16:9). Null where no 2D canvas exists (tests, old browsers). Never throws. */
export async function drawLayout(layout: SlideLayout, theme: Theme, o: { width?: number; step?: number; marks?: boolean } = {}): Promise<HTMLCanvasElement | null> {
  try {
    const width = Math.max(32, Math.min(4096, Math.round(o.width ?? 960)));
    const height = Math.round((width * CANVAS_H) / CANVAS_W);
    const canvas = newCanvas(width, height);
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const scale = width / CANVAS_W;
    const marks = o.marks ?? true;
    const boxes = layout.boxes.filter((b) => o.step === undefined || (b.step ?? 0) <= o.step);

    const fonts = new Set<string>();
    for (const b of boxes) if (b.type === 'text') fonts.add(cssFont(fontFamily(theme, b.style.font, 'web'), b.style.size, b.style.weight, b.style.italic));
    await fontsReady([...fonts]);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = layout.background;
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);
    const cache: ImageCache = new Map();
    for (const box of boxes) await drawBox(ctx, box, theme, marks, scale, cache);
    return canvas;
  } catch {
    return null;
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): SlideShot | null {
  try {
    const url = canvas.toDataURL('image/jpeg', quality);
    const data = url.slice(url.indexOf(',') + 1);
    return data ? { data, mime: 'image/jpeg', width: canvas.width, height: canvas.height } : null;
  } catch {
    // A tainted canvas refuses to export.
    return null;
  }
}

/** One slide as a JPEG for the AI. Defaults: width 960, quality 0.72. */
export async function slideShot(layout: SlideLayout, theme: Theme, o: { width?: number; quality?: number; marks?: boolean } = {}): Promise<SlideShot | null> {
  const canvas = await drawLayout(layout, theme, { width: o.width ?? 960, marks: o.marks });
  return canvas ? encode(canvas, o.quality ?? 0.72) : null;
}

/** Many slides in one JPEG: a grid of tiles, each with its label (e.g. "3") in a badge just above it. Defaults: cols 3, tileWidth 480. */
export async function contactSheet(
  tiles: { layout: SlideLayout; theme: Theme; label: string }[],
  o: { cols?: number; tileWidth?: number; quality?: number } = {},
): Promise<SlideShot | null> {
  try {
    if (!tiles.length) return null;
    const grid = sheetGrid(tiles.length, o.cols ?? 3, o.tileWidth ?? 480);
    const canvas = newCanvas(grid.width, grid.height);
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    ctx.fillStyle = SHEET_BG;
    ctx.fillRect(0, 0, grid.width, grid.height);
    for (let i = 0; i < tiles.length; i++) {
      const { x, y } = grid.cells[i];
      const tile = tiles[i];
      const drawn = await drawLayout(tile.layout, tile.theme, { width: grid.tileW });
      if (drawn) ctx.drawImage(drawn, x, y, grid.tileW, grid.tileH);
      else {
        ctx.fillStyle = '#f4f4f5';
        ctx.fillRect(x, y, grid.tileW, grid.tileH);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, grid.tileW - 1, grid.tileH - 1);
      drawBadge(ctx, tile.label, x, y - SHEET_LABEL + 3, SHEET_LABEL - 6);
    }
    return encode(canvas, o.quality ?? 0.72);
  } catch {
    return null;
  }
}

function drawBadge(ctx: Ctx, label: string, x: number, y: number, h: number) {
  const size = Math.round(h * 0.68);
  ctx.save();
  ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const w = Math.max(h, Math.round(ctx.measureText(label).width + size * 1.1));
  roundedPath(ctx, x, y, w, h, h * 0.25);
  ctx.fillStyle = 'rgba(17,24,39,0.88)';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

// Text measuring and fitting. In the browser, widths come from a canvas using the
// real font; elsewhere (tests, server) a conservative estimate is used.

export type Measure = (text: string, font: string) => number;

let canvasCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

function context() {
  if (canvasCtx !== undefined) return canvasCtx;
  try {
    if (typeof OffscreenCanvas !== 'undefined') canvasCtx = new OffscreenCanvas(8, 8).getContext('2d');
    else if (typeof document !== 'undefined') canvasCtx = document.createElement('canvas').getContext('2d');
    else canvasCtx = null;
  } catch {
    canvasCtx = null;
  }
  return canvasCtx;
}

const WIDE = /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Rough width in em units, used when no canvas exists. Errs on the wide side. */
export function estimateEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (WIDE.test(ch)) em += 1;
    else if (/[mwMW@]/.test(ch)) em += 0.86;
    else if (/[A-Z0-9]/.test(ch)) em += 0.66;
    else if (/[iljtf.,;:'!|]/.test(ch)) em += 0.3;
    else if (ch === ' ') em += 0.28;
    else em += 0.54;
  }
  return em;
}

const cache = new Map<string, number>();

export const measureText: Measure = (text, font) => {
  const key = `${font}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const ctx = context();
  let width: number;
  if (ctx) {
    ctx.font = font;
    width = ctx.measureText(text).width;
  } else {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
    width = estimateEm(text) * size;
  }
  if (cache.size > 20_000) cache.clear();
  cache.set(key, width);
  return width;
};

/** Forget measured widths, for example after web fonts finish loading. */
export function resetMeasureCache() {
  cache.clear();
}

export function cssFont(family: string, size: number, weight = 400, italic = false) {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
}

/** Splits text into words, keeping CJK characters breakable one by one. */
function tokens(paragraph: string): string[] {
  const out: string[] = [];
  const re = /[\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFF60]|[^\s\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFF60]+|\s+/g;
  for (const m of paragraph.matchAll(re)) out.push(m[0]);
  return out;
}

/** Greedy line wrap. Returns the lines as drawn. */
export function wrapLines(text: string, maxWidth: number, font: string, measure: Measure = measureText): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of tokens(paragraph)) {
      const candidate = line + token;
      if (!line.trim() || measure(candidate.trimEnd(), font) <= maxWidth) {
        line = candidate;
        continue;
      }
      lines.push(line.trimEnd());
      line = /^\s+$/.test(token) ? '' : token;
      // A single word wider than the box: break it by characters.
      while (measure(line, font) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut), font) > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export interface FitOptions {
  family: string;
  weight?: number;
  italic?: boolean;
  width: number;
  height: number;
  maxSize: number;
  minSize: number;
  lineHeight?: number;
  /** Most lines allowed regardless of height. */
  maxLines?: number;
  measure?: Measure;
}

export interface FitResult {
  size: number;
  lines: string[];
  /** Height the text takes at the chosen size. */
  height: number;
  overflow: boolean;
}

/** Largest size between maxSize and minSize at which the text fits the box. */
export function fitText(text: string, o: FitOptions): FitResult {
  const lh = o.lineHeight ?? 1.2;
  const measure = o.measure ?? measureText;
  const step = o.maxSize > 80 ? 4 : 2;
  let last: FitResult | null = null;
  for (let size = o.maxSize; size >= o.minSize; size -= step) {
    const font = cssFont(o.family, size, o.weight, o.italic);
    // Leave a small safety margin for renderer differences.
    const lines = wrapLines(text, o.width * 0.97, font, measure);
    const height = lines.length * size * lh;
    last = { size, lines, height, overflow: false };
    if (height <= o.height && (!o.maxLines || lines.length <= o.maxLines)) return last;
  }
  const size = o.minSize;
  const lines = last?.lines ?? wrapLines(text, o.width * 0.97, cssFont(o.family, size, o.weight), measure);
  return { size, lines, height: lines.length * size * lh, overflow: true };
}

/** Height a text takes at a fixed size. */
export function textHeight(text: string, size: number, width: number, family: string, weight = 400, lineHeight = 1.2, measure: Measure = measureText) {
  const lines = wrapLines(text, width * 0.97, cssFont(family, size, weight), measure);
  return lines.length * size * lineHeight;
}

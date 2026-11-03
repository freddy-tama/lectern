// A library of SVG decoration motifs (confetti, waves, sprigs, ribbons and so on), drawn from
// theme colours at any size. Themes place them as image boxes, and the AI agent and users
// can place them as free elements. Plain paths, circles and rects only, so PowerPoint export
// can rasterise them: no text, filters, scripts or outside references.

/** The colours a motif is drawn in; usually a theme's accent, accent2 and muted or ink. */
export interface DecorColors {
  a: string;
  b: string;
  c?: string;
}

export type DecorMotif =
  | 'confetti' | 'waves' | 'wave-corner' | 'dots' | 'rings' | 'sprigs' | 'sparkles' | 'zigzag' | 'blob'
  | 'brush' | 'hatch' | 'dot-grid' | 'clouds' | 'sunburst' | 'mosaic' | 'doodle-frame' | 'circuit' | 'ribbons';

/** For pickers and for the AI: what each motif looks like and where it suits. */
export const DECOR_MOTIFS: { id: DecorMotif; label: string; description: string; /** Natural aspect (w/h) it is designed for. */ aspect: number }[] = [
  { id: 'confetti', label: 'Confetti', description: 'Scattered little squares, circles, triangles and squiggles. Playful; for celebrations, young audiences, openers.', aspect: 1.6 },
  { id: 'waves', label: 'Waves', description: 'Layered waves along the bottom edge. Calm; a footer band for titles, sections and closing slides.', aspect: 6 },
  { id: 'wave-corner', label: 'Wave corner', description: 'Soft layered curves filling the top-right corner. Friendly and calm; frames a title.', aspect: 1 },
  { id: 'dots', label: 'Scattered dots', description: 'Loose dots of many sizes. Quiet; fills an empty corner without drawing the eye.', aspect: 1.5 },
  { id: 'rings', label: 'Rings', description: 'Concentric rings radiating from the top-right corner. Modern and neutral; business, tech, reports.', aspect: 1 },
  { id: 'sprigs', label: 'Sprigs', description: 'Two leafy sprigs growing up from the bottom edge. Natural and gentle; wellbeing, nature, education.', aspect: 1 },
  { id: 'sparkles', label: 'Sparkles', description: 'Four-point stars and tiny dots. Magical or celebratory; achievements, launches, children.', aspect: 1.3 },
  { id: 'zigzag', label: 'Zigzag band', description: 'Two interleaved ric-rac zigzag lines in a thin band. Crafty and cheerful; a divider or header strip.', aspect: 10 },
  { id: 'blob', label: 'Organic blob', description: 'Overlapping soft organic shapes. Friendly backdrop for a picture, a number or a short phrase.', aspect: 1 },
  { id: 'brush', label: 'Brush stroke', description: 'A tapered brush-stroke underline. Highlights a title or key phrase; editorial and creative.', aspect: 8 },
  { id: 'hatch', label: 'Hatching', description: 'Fine diagonal lines filling the top-right corner. Technical, editorial and serious; reports and papers.', aspect: 1 },
  { id: 'dot-grid', label: 'Dot grid', description: 'A regular grid of dots fading from the top-right. Structured and tidy; pitch decks, data, product.', aspect: 1.2 },
  { id: 'clouds', label: 'Clouds', description: 'Three soft clouds at different heights. Light and dreamy; young audiences, weather, ideas, the sky.', aspect: 2 },
  { id: 'sunburst', label: 'Sunburst', description: 'Rays spreading from a sun in the top-right corner. Energetic and optimistic; openers, announcements.', aspect: 1 },
  { id: 'mosaic', label: 'Mosaic', description: 'Small triangles thinning out from the top-right corner. Geometric and bold; design, creative, tech.', aspect: 1 },
  { id: 'doodle-frame', label: 'Doodle frame', description: 'A hand-drawn wobbly frame with tiny sparkles at the corners. Casual; frames a picture or a whole slide.', aspect: 1.78 },
  { id: 'circuit', label: 'Circuit', description: 'Fine traces with bends and round pads, entering from the right edge. Technical; engineering, AI, data.', aspect: 1.6 },
  { id: 'ribbons', label: 'Ribbons', description: 'Flowing translucent ribbons across the width. Elegant and dynamic; titles, closings, brand-forward decks.', aspect: 2 },
];

const IDS = new Set<string>(DECOR_MOTIFS.map((m) => m.id));

/** True for the id of a motif in DECOR_MOTIFS. */
export function isDecorMotif(v: unknown): v is DecorMotif {
  return typeof v === 'string' && IDS.has(v);
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** A number as short text: one decimal at most. */
const n = (v: number) => String(Math.round(v * 10) / 10);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Colours go into SVG attributes, so only plain colour characters get through. */
function safeColor(v: string | undefined, fallback: string) {
  const s = (v ?? '').trim();
  return /^[#\w(),.%\s-]{1,40}$/.test(s) ? s : fallback;
}

/** A small seeded random generator (mulberry32) returning numbers in [0, 1). */
function prng(seed: number) {
  let a = Math.floor(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ctx {
  w: number;
  h: number;
  /** The shorter side: sizes scale with it so shapes stay in proportion on stretched boxes. */
  s: number;
  a: string;
  b: string;
  c: string;
  rnd: () => number;
}

const between = (k: Ctx, lo: number, hi: number) => lo + (hi - lo) * k.rnd();
const pick = (k: Ctx) => [k.a, k.b, k.c][Math.floor(k.rnd() * 3)]!;
const op = (v: number) => (v >= 1 ? '' : ` opacity="${n(v)}"`);

/** A four-point star with concave sides, centred on (x, y). */
function star(x: number, y: number, r: number, fill: string, opacity = 1) {
  const d = `M${n(x)} ${n(y - r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Q${n(x)} ${n(y)} ${n(x)} ${n(y + r)}Q${n(x)} ${n(y)} ${n(x - r)} ${n(y)}Q${n(x)} ${n(y)} ${n(x)} ${n(y - r)}Z`;
  return `<path d="${d}" fill="${fill}"${op(opacity)}/>`;
}

function circle(x: number, y: number, r: number, fill: string, opacity = 1) {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}"${op(opacity)}/>`;
}

/** A smooth closed curve through points (Catmull-Rom turned into cubic Béziers). */
function smoothClosed(pts: [number, number][]) {
  const m = pts.length;
  let d = `M${n(pts[0]![0])} ${n(pts[0]![1])}`;
  for (let i = 0; i < m; i++) {
    const p0 = pts[(i - 1 + m) % m]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % m]!;
    const p3 = pts[(i + 2) % m]!;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d}Z`;
}

/** A wave filling from a wavy top edge down to the bottom of the box. */
function wavePath(w: number, h: number, baseline: number, amp: number, segments: number, phase: number) {
  const sw = w / segments;
  let x = -sw * phase;
  let d = `M${n(x)} ${n(baseline)}Q${n(x + sw / 2)} ${n(baseline - amp)} ${n(x + sw)} ${n(baseline)}`;
  x += sw;
  while (x < w + sw) {
    x += sw;
    d += `T${n(x)} ${n(baseline)}`;
  }
  return `${d}L${n(x)} ${n(h + 2)}L${n(-sw * phase)} ${n(h + 2)}Z`;
}

// ─── Motifs ───────────────────────────────────────────────────────────

const MOTIFS: Record<DecorMotif, (k: Ctx) => string> = {
  confetti(k) {
    const count = clamp(Math.round((k.w * k.h) / (k.s * k.s) * 20), 24, 44);
    let out = '';
    for (let i = 0; i < count; i++) {
      const x = between(k, 0.03, 0.97) * k.w;
      const y = between(k, 0.03, 0.97) * k.h;
      const size = k.s * between(k, 0.05, 0.1);
      const fill = pick(k);
      const o = between(k, 0.55, 0.95);
      const kind = Math.floor(k.rnd() * 4);
      const rot = Math.round(k.rnd() * 180);
      if (kind === 0) out += `<rect x="${n(x - size / 2)}" y="${n(y - size / 3)}" width="${n(size)}" height="${n(size * 0.66)}" rx="${n(size * 0.12)}" fill="${fill}"${op(o)} transform="rotate(${rot} ${n(x)} ${n(y)})"/>`;
      else if (kind === 1) out += circle(x, y, size * 0.4, fill, o);
      else if (kind === 2) out += `<path d="M${n(x)} ${n(y - size * 0.55)}L${n(x + size * 0.55)} ${n(y + size * 0.45)}L${n(x - size * 0.55)} ${n(y + size * 0.45)}Z" fill="${fill}"${op(o)} transform="rotate(${rot} ${n(x)} ${n(y)})"/>`;
      else out += `<path d="M${n(x - size)} ${n(y)}q${n(size * 0.5)} ${n(-size * 0.7)} ${n(size)} 0t${n(size)} 0" fill="none" stroke="${fill}" stroke-width="${n(Math.max(2, size * 0.2))}" stroke-linecap="round"${op(o)} transform="rotate(${rot} ${n(x)} ${n(y)})"/>`;
    }
    return out;
  },

  waves(k) {
    const segs = clamp(Math.round(k.w / (k.h * 1.3)), 2, 9);
    const layers: [number, number, string, number, number][] = [
      [0.34, 0.2, k.b, 0.5, 0.2],
      [0.56, 0.17, k.a, 0.55, 0.65],
      [0.78, 0.14, k.c, 1, 0.1],
    ];
    return layers.map(([base, amp, fill, o, phase]) => `<path d="${wavePath(k.w, k.h, k.h * base, k.h * amp, segs, phase)}" fill="${fill}"${op(o)}/>`).join('');
  },

  'wave-corner'(k) {
    const layers: [number, string, number][] = [[0.74, k.b, 0.55], [0.55, k.a, 0.6], [0.34, k.c, 0.95]];
    return layers.map(([f, fill, o]) => {
      const rx = k.w * f;
      const ry = k.h * f;
      const d = `M${n(k.w - rx)} 0L${n(k.w)} 0L${n(k.w)} ${n(ry)}C${n(k.w - rx * 0.25)} ${n(ry * 1.06)} ${n(k.w - rx * 0.36)} ${n(ry * 0.52)} ${n(k.w - rx * 0.6)} ${n(ry * 0.44)}S${n(k.w - rx * 0.86)} 0 ${n(k.w - rx)} 0Z`;
      return `<path d="${d}" fill="${fill}"${op(o)}/>`;
    }).join('');
  },

  dots(k) {
    const count = clamp(Math.round((k.w * k.h) / (k.s * k.s) * 18), 22, 40);
    const placed: [number, number, number][] = [];
    let out = '';
    for (let i = 0; i < count; i++) {
      let best: [number, number, number] | null = null;
      for (let tries = 0; tries < 8; tries++) {
        const r = k.s * between(k, 0.012, 0.055) * (i % 7 === 0 ? 1.4 : 1);
        const x = r + k.rnd() * (k.w - 2 * r);
        const y = r + k.rnd() * (k.h - 2 * r);
        best = [x, y, r];
        if (placed.every(([px, py, pr]) => Math.hypot(px - x, py - y) > pr + r + k.s * 0.02)) break;
      }
      placed.push(best!);
      const [x, y, r] = best!;
      const fill = pick(k);
      out += i % 9 === 4
        ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none" stroke="${fill}" stroke-width="${n(Math.max(2, r * 0.25))}"${op(0.8)}/>`
        : circle(x, y, r, fill, between(k, 0.4, 0.9));
    }
    return out;
  },

  rings(k) {
    let out = circle(k.w, 0, k.s * 0.19, k.a, 0.9);
    for (let i = 1; i < 6; i++) {
      const r = k.s * (0.19 + i * 0.16);
      const stroke = i % 2 ? k.b : k.a;
      out += `<circle cx="${n(k.w)}" cy="0" r="${n(r)}" fill="none" stroke="${stroke}" stroke-width="${n(k.s * (i === 3 ? 0.03 : 0.012))}"${op(clamp(0.95 - i * 0.14, 0.2, 1))}/>`;
    }
    out += circle(k.w - k.s * 0.62, k.s * 0.2, k.s * 0.025, k.c, 0.9);
    out += circle(k.w - k.s * 0.3, k.s * 0.58, k.s * 0.018, k.c, 0.8);
    return out;
  },

  sprigs(k) {
    const sprig = (x0: number, y0: number, x1: number, y1: number, bend: number, leaves: number, len: number) => {
      const cx = (x0 + x1) / 2 + bend;
      const cy = (y0 + y1) / 2;
      let out = `<path d="M${n(x0)} ${n(y0)}Q${n(cx)} ${n(cy)} ${n(x1)} ${n(y1)}" fill="none" stroke="${k.a}" stroke-width="${n(Math.max(2, k.s * 0.012))}" stroke-linecap="round"/>`;
      for (let i = 0; i <= leaves; i++) {
        const t = leaves ? 0.14 + (0.86 * i) / leaves : 1;
        const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
        const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
        const tx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx);
        const ty = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy);
        const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
        const side = i === leaves ? 0 : i % 2 ? 48 : -48;
        const l = len * (i === leaves ? 1 : 1 - t * 0.35);
        const fill = i % 3 === 2 ? k.b : k.a;
        out += `<path d="M0 0Q${n(l * 0.5)} ${n(-l * 0.34)} ${n(l)} 0Q${n(l * 0.5)} ${n(l * 0.34)} 0 0Z" fill="${fill}"${op(i % 3 === 2 ? 0.85 : 0.75)} transform="translate(${n(x)} ${n(y)}) rotate(${n(ang + side)})"/>`;
      }
      return out;
    };
    const len = k.s * 0.17;
    return sprig(k.w * 0.16, k.h * 1.02, k.w * 0.5, k.h * 0.1, -k.w * 0.1, 6, len)
      + sprig(k.w * 0.42, k.h * 1.02, k.w * 0.88, k.h * 0.38, k.w * 0.08, 5, len * 0.85);
  },

  sparkles(k) {
    const count = clamp(Math.round((k.w * k.h) / (k.s * k.s) * 6), 6, 10);
    const placed: [number, number, number][] = [];
    let out = '';
    for (let i = 0; i < count; i++) {
      const r = k.s * (i === 0 ? 0.2 : between(k, 0.04, 0.12));
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 10; tries++) {
        x = r + k.rnd() * (k.w - 2 * r);
        y = r + k.rnd() * (k.h - 2 * r);
        if (placed.every(([px, py, pr]) => Math.hypot(px - x, py - y) > (pr + r) * 0.9)) break;
      }
      placed.push([x, y, r]);
      out += star(x, y, r, i % 3 === 1 ? k.b : i % 3 === 2 ? k.c : k.a, between(k, 0.7, 1));
    }
    for (let i = 0; i < 12; i++) out += circle(between(k, 0.02, 0.98) * k.w, between(k, 0.02, 0.98) * k.h, k.s * between(k, 0.008, 0.02), pick(k), between(k, 0.4, 0.85));
    return out;
  },

  zigzag(k) {
    const tooth = k.h * 0.8;
    const count = Math.max(2, Math.round(k.w / tooth));
    const step = k.w / count;
    const line = (shift: number, color: string, o: number) => {
      let d = '';
      for (let i = -1; i <= count + 1; i++) {
        const x = i * step + shift;
        const y = i % 2 ? k.h * 0.84 : k.h * 0.16;
        d += `${d ? 'L' : 'M'}${n(x)} ${n(y)}`;
      }
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(k.h * 0.14)}" stroke-linejoin="round" stroke-linecap="round"${op(o)}/>`;
    };
    return line(0, k.a, 1) + line(step, k.b, 0.75);
  },

  blob(k) {
    const shape = (cx: number, cy: number, rx: number, ry: number, fill: string, o: number) => {
      const pts: [number, number][] = [];
      const m = 8;
      for (let i = 0; i < m; i++) {
        const ang = (i / m) * Math.PI * 2 + k.rnd() * 0.25;
        const f = between(k, 0.78, 1);
        pts.push([cx + Math.cos(ang) * rx * f, cy + Math.sin(ang) * ry * f]);
      }
      return `<path d="${smoothClosed(pts)}" fill="${fill}"${op(o)}/>`;
    };
    return shape(k.w * 0.46, k.h * 0.5, k.w * 0.44, k.h * 0.44, k.a, 0.9)
      + shape(k.w * 0.7, k.h * 0.62, k.w * 0.28, k.h * 0.3, k.b, 0.7)
      + circle(k.w * 0.14, k.h * 0.16, k.s * 0.07, k.c, 0.85)
      + circle(k.w * 0.9, k.h * 0.14, k.s * 0.035, k.b, 0.9);
  },

  brush(k) {
    const steps = 22;
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    const tilt = between(k, -0.08, 0.08) * k.h;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = k.w * (0.015 + 0.97 * t);
      const mid = k.h * 0.5 + tilt * (t - 0.5) + Math.sin(t * 5 + k.rnd()) * k.h * 0.03;
      const taper = Math.pow(Math.sin(Math.PI * clamp(t * 0.96 + 0.02, 0, 1)), 0.45);
      const thick = k.h * 0.62 * taper * between(k, 0.88, 1);
      top.push([x, mid - thick / 2 + (k.rnd() - 0.5) * k.h * 0.025]);
      bottom.push([x, mid + thick / 2 + (k.rnd() - 0.5) * k.h * 0.025]);
    }
    const poly = [...top, ...bottom.reverse()].map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('');
    let out = `<path d="${poly}Z" fill="${k.a}"${op(0.92)} stroke="${k.a}" stroke-width="${n(k.h * 0.04)}" stroke-linejoin="round"/>`;
    for (let i = 0; i < 3; i++) {
      const y = k.h * (0.4 + i * 0.1);
      out += `<path d="M${n(k.w * (0.12 + i * 0.05))} ${n(y)}L${n(k.w * (0.5 + i * 0.12))} ${n(y + (k.rnd() - 0.5) * k.h * 0.04)}" stroke="${k.b}" stroke-width="${n(Math.max(1.5, k.h * 0.022))}" stroke-linecap="round"${op(0.55)} fill="none"/>`;
    }
    return out + `<path d="M${n(k.w * 0.1)} ${n(k.h * 0.96)}L${n(k.w * 0.62)} ${n(k.h * 0.94)}" stroke="${k.b}" stroke-width="${n(Math.max(2, k.h * 0.05))}" stroke-linecap="round"${op(0.7)} fill="none"/>`;
  },

  hatch(k) {
    const lines = 18;
    let out = '';
    for (let i = 1; i <= lines; i++) {
      const f = i / lines;
      const heavy = i % 4 === 0;
      out += `<path d="M${n(k.w - k.w * f)} 0L${n(k.w)} ${n(k.h * f)}" stroke="${heavy ? k.b : k.a}" stroke-width="${n(k.s * (heavy ? 0.011 : 0.006))}" stroke-linecap="round"${op(clamp(1 - f * 0.65, 0.3, 1))}/>`;
    }
    return out + `<path d="M${n(k.w * 0.82)} 0L${n(k.w)} 0L${n(k.w)} ${n(k.h * 0.18)}Z" fill="${k.c}"${op(0.95)}/>`;
  },

  'dot-grid'(k) {
    const pitch = Math.max(k.s * 0.1, Math.sqrt((k.w * k.h) / 150));
    const cols = Math.max(2, Math.floor(k.w / pitch));
    const rows = Math.max(2, Math.floor(k.h / pitch));
    const gx = (k.w - (cols - 1) * pitch) / 2;
    const gy = (k.h - (rows - 1) * pitch) / 2;
    const groups = new Map<string, string>();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const dist = Math.hypot((cols - 1 - c) / cols, r / rows) / 1.41;
      const o = Math.round(clamp(1 - dist * 0.95, 0.12, 1) * 4) / 4;
      const accent = (r * 7 + c * 3) % 11 === 0;
      const key = `${accent ? k.b : k.a}|${o}`;
      groups.set(key, `${groups.get(key) ?? ''}<circle cx="${n(gx + c * pitch)}" cy="${n(gy + r * pitch)}" r="${n(pitch * (accent ? 0.15 : 0.1))}"/>`);
    }
    return [...groups].map(([key, body]) => {
      const [fill, o] = key.split('|');
      return `<g fill="${fill}"${op(Number(o))}>${body}</g>`;
    }).join('');
  },

  clouds(k) {
    const cloud = (cx: number, base: number, wd: number, fill: string, o: number) => {
      const hb = wd * 0.22;
      return `<g fill="${fill}"${op(o)}><rect x="${n(cx - wd / 2)}" y="${n(base - hb)}" width="${n(wd)}" height="${n(hb)}" rx="${n(hb / 2)}"/>`
        + `<circle cx="${n(cx - wd * 0.18)}" cy="${n(base - hb)}" r="${n(wd * 0.17)}"/>`
        + `<circle cx="${n(cx + wd * 0.08)}" cy="${n(base - hb * 1.25)}" r="${n(wd * 0.24)}"/>`
        + `<circle cx="${n(cx + wd * 0.3)}" cy="${n(base - hb * 0.9)}" r="${n(wd * 0.14)}"/></g>`;
    };
    return cloud(k.w * 0.7, k.h * 0.52, Math.min(k.w * 0.32, k.h * 0.85), k.b, 0.75)
      + cloud(k.w * 0.3, k.h * 0.94, Math.min(k.w * 0.5, k.h * 1.3), k.a, 0.9)
      + cloud(k.w * 0.82, k.h * 0.98, Math.min(k.w * 0.2, k.h * 0.5), k.c, 0.8);
  },

  sunburst(k) {
    const rays = 11;
    const reach = Math.hypot(k.w, k.h);
    let out = '';
    for (let i = 0; i < rays; i++) {
      const phi = Math.PI / 2 + (Math.PI / 2) * ((i + 0.5) / rays);
      const half = (Math.PI / 2 / rays) * 0.26;
      const len = reach * between(k, 0.45, 0.8);
      const p = (ang: number) => `${n(k.w + Math.cos(ang) * len)} ${n(Math.sin(ang) * len)}`;
      out += `<path d="M${n(k.w)} 0L${p(phi - half)}L${p(phi + half)}Z" fill="${i % 2 ? k.b : k.a}"${op(i % 2 ? 0.7 : 0.85)}/>`;
    }
    return out + circle(k.w, 0, k.s * 0.26, k.b, 0.9) + circle(k.w, 0, k.s * 0.18, k.c, 1);
  },

  mosaic(k) {
    const cell = Math.max(k.s / 6, Math.sqrt((k.w * k.h) / 70));
    const cols = Math.max(2, Math.round(k.w / cell));
    const rows = Math.max(2, Math.round(k.h / cell));
    const cw = k.w / cols;
    const ch = k.h / rows;
    let out = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const dist = ((cols - 1 - c) / cols + r / rows) / 2;
      for (const half of [0, 1]) {
        if (k.rnd() < dist * 1.35) continue;
        const x = c * cw;
        const y = r * ch;
        const d = half
          ? `M${n(x + cw)} ${n(y)}L${n(x + cw)} ${n(y + ch)}L${n(x)} ${n(y + ch)}Z`
          : `M${n(x)} ${n(y)}L${n(x + cw)} ${n(y)}L${n(x)} ${n(y + ch)}Z`;
        out += `<path d="${d}" fill="${pick(k)}"${op(Math.round(between(k, 0.4, 0.95) * 20) / 20)}/>`;
      }
    }
    return out;
  },

  'doodle-frame'(k) {
    const m = k.s * 0.07;
    const x0 = m;
    const y0 = m;
    const x1 = k.w - m;
    const y1 = k.h - m;
    const wobble = k.s * 0.007;
    const step = Math.max(k.s * 0.09, (2 * (k.w + k.h)) / 70);
    const frame = (color: string, o: number, width: number, shift: number) => {
      const pts: [number, number][] = [];
      const side = (ax: number, ay: number, bx: number, by: number) => {
        const len = Math.hypot(bx - ax, by - ay);
        const cnt = Math.max(2, Math.round(len / step));
        for (let i = 0; i < cnt; i++) {
          const t = i / cnt;
          pts.push([ax + (bx - ax) * t + (k.rnd() - 0.5) * 2 * wobble + shift, ay + (by - ay) * t + (k.rnd() - 0.5) * 2 * wobble + shift]);
        }
      };
      side(x0, y0, x1, y0);
      side(x1, y0, x1, y1);
      side(x1, y1, x0, y1);
      side(x0, y1, x0, y0);
      let d = `M${n((pts[0]![0] + pts[pts.length - 1]![0]) / 2)} ${n((pts[0]![1] + pts[pts.length - 1]![1]) / 2)}`;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % pts.length]!;
        d += `Q${n(p[0])} ${n(p[1])} ${n((p[0] + q[0]) / 2)} ${n((p[1] + q[1]) / 2)}`;
      }
      return `<path d="${d}Z" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"${op(o)}/>`;
    };
    return frame(k.a, 0.95, k.s * 0.016, 0) + frame(k.b, 0.7, k.s * 0.01, k.s * 0.014)
      + star(x0, y0, k.s * 0.07, k.c, 0.95) + star(x1, y1, k.s * 0.055, k.c, 0.9) + star(x1 - k.s * 0.1, y0 - k.s * 0.01, k.s * 0.03, k.a, 0.8)
      + circle(x0 + k.s * 0.07, y1 + k.s * 0.005, k.s * 0.014, k.b, 0.9) + circle(x1, y0 + k.s * 0.09, k.s * 0.012, k.c, 0.85);
  },

  circuit(k) {
    const g = Math.max(3, k.s * 0.05);
    const pitch = g * 3;
    const rows = Math.max(2, Math.floor(k.h / pitch));
    const top = (k.h - (rows - 1) * pitch) / 2;
    const width = Math.max(2, k.s * 0.011);
    let out = '';
    for (let r = 0; r < rows; r++) {
      if (r % 5 === 4) continue;
      const color = r % 2 ? k.b : k.a;
      const target = k.w * between(k, 0.3, 0.85);
      let x = k.w;
      let y = top + r * pitch;
      let d = `M${n(x)} ${n(y)}`;
      for (let guard = 0; guard < 4 && x > target; guard++) {
        x = Math.max(target, x - g * between(k, 3, 9));
        d += `H${n(x)}`;
        if (x <= target) break;
        const dy = (k.rnd() < 0.5 ? -1 : 1) * g;
        x -= g;
        y += dy;
        d += `L${n(x)} ${n(y)}`;
      }
      out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linejoin="round" stroke-linecap="round"${op(0.9)}/>`;
      out += k.rnd() < 0.6
        ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(g * 0.42)}" fill="none" stroke="${color}" stroke-width="${n(width)}"/>`
        : circle(x, y, g * 0.34, color, 0.95);
      out += `<rect x="${n(k.w - g * 0.55)}" y="${n(top + r * pitch - g * 0.4)}" width="${n(g * 0.55)}" height="${n(g * 0.8)}" fill="${k.c}"${op(0.7)}/>`;
    }
    return out;
  },

  ribbons(k) {
    const ribbon = (y1: number, y2: number, bend: number, thick: number, fill: string, o: number) => {
      const c1x = k.w * 0.3;
      const c2x = k.w * 0.7;
      const c1y = y1 - bend;
      const c2y = y2 + bend;
      return `<path d="M0 ${n(y1)}C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(k.w)} ${n(y2)}L${n(k.w)} ${n(y2 + thick * 0.25)}C${n(c2x)} ${n(c2y + thick)} ${n(c1x)} ${n(c1y + thick * 0.8)} 0 ${n(y1 + thick * 0.2)}Z" fill="${fill}"${op(o)}/>`;
    };
    const defs = `<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${k.a}"/><stop offset="1" stop-color="${k.b}"/></linearGradient></defs>`;
    return defs
      + ribbon(k.h * 0.72, k.h * 0.32, k.h * 0.5, k.h * 0.2, 'url(#rg)', 0.55)
      + ribbon(k.h * 0.52, k.h * 0.62, -k.h * 0.45, k.h * 0.22, k.a, 0.6)
      + ribbon(k.h * 0.3, k.h * 0.78, k.h * 0.35, k.h * 0.16, k.c, 0.5)
      + ribbon(k.h * 0.86, k.h * 0.46, -k.h * 0.3, k.h * 0.1, k.b, 0.85);
  },
};

// ─── Public ───────────────────────────────────────────────────────────

/**
 * Complete standalone SVG markup (viewBox 0 0 w h) for a motif. The same motif, colours,
 * size and seed always give the same picture; scattered motifs vary with the seed.
 * Corner motifs sit in the top-right corner and bands along the bottom edge; flip moves them.
 */
export function decorSvg(motif: DecorMotif, colors: DecorColors, w: number, h: number, seed = 1, flip?: 'x' | 'y' | 'xy'): string {
  const draw = MOTIFS[motif];
  if (!draw) throw new Error(`Unknown decoration motif: ${String(motif)}`);
  const width = Math.max(8, Math.round(Number.isFinite(w) ? w : 800));
  const height = Math.max(8, Math.round(Number.isFinite(h) ? h : 600));
  const a = safeColor(colors.a, '#888888');
  const k: Ctx = {
    w: width, h: height, s: Math.min(width, height), a, b: safeColor(colors.b, a), c: safeColor(colors.c, a),
    rnd: prng((Number.isFinite(seed) ? seed : 1) * 7919 + DECOR_MOTIFS.findIndex((m) => m.id === motif) * 104729 + 17),
  };
  const body = draw(k);
  const matrix = flip === 'x' ? `-1 0 0 1 ${width} 0`
    : flip === 'y' ? `1 0 0 -1 0 ${height}`
      : flip === 'xy' ? `-1 0 0 -1 ${width} ${height}` : '';
  const inner = matrix ? `<g transform="matrix(${matrix})">${body}</g>` : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${inner}</svg>`;
}

const urlCache = new Map<string, string>();

/** decorSvg as a data: URL (image/svg+xml, UTF-8, URI-encoded). Layouts ask for the same ones again and again, so recent ones are kept. */
export function decorDataUrl(motif: DecorMotif, colors: DecorColors, w: number, h: number, seed = 1, flip?: 'x' | 'y' | 'xy'): string {
  const key = [motif, colors.a, colors.b, colors.c ?? '', w, h, seed, flip ?? ''].join('|');
  let url = urlCache.get(key);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(decorSvg(motif, colors, w, h, seed, flip))}`;
    if (urlCache.size >= 300) urlCache.clear();
    urlCache.set(key, url);
  }
  return url;
}

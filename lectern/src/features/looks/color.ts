// Small colour helpers for the look editor: parsing, mixing and WCAG contrast.

export function normalizeHex(value: string): string | null {
  const v = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${v.split('').map((c) => c + c).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toUpperCase();
  return null;
}

function rgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? '#000000';
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: number[]) {
  return `#${[r, g, b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Mixes b into a by t (0 gives a, 1 gives b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function isDark(hex: string) {
  return luminance(hex) < 0.2;
}

/** White or near-black, whichever reads better on the colour. */
export function readableOn(hex: string): string {
  return contrast(hex, '#FFFFFF') >= contrast(hex, '#111111') ? '#FFFFFF' : '#111111';
}

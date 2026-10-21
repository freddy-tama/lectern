// QR codes as images a slide can place: crisp SVG on screen, a GIF for PowerPoint
// (which can't show SVG). Always dark on light, which every phone camera reads.

import qrcode from 'qrcode-generator';

/** Longest text a slide QR code carries. Past this it gets too dense to scan across a room. */
export const QR_TEXT_MAX = 900;

/** UTF-8 bytes as a byte string, which is what the generator's byte mode reads. */
function bytes(value: string): string {
  return String.fromCharCode(...new TextEncoder().encode(value));
}

function make(value: string) {
  const qr = qrcode(0, value.length > 300 ? 'L' : 'M');
  qr.addData(bytes(value.slice(0, QR_TEXT_MAX)));
  qr.make();
  return qr;
}

/** An SVG data URL. The quiet zone is two modules wide. */
export function qrSvgDataUrl(value: string, dark = '#111111', light = '#FFFFFF'): string {
  const qr = make(value);
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let run = 1;
      while (c + run < n && qr.isDark(r, c + run)) run++;
      d += `M${c + 2} ${r + 2}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  const size = n + 4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A GIF data URL, large enough to stay sharp on a projected slide. */
export function qrGifDataUrl(value: string): string {
  const qr = make(value);
  const n = qr.getModuleCount() + 4;
  const cell = Math.max(4, Math.ceil(720 / n));
  return qr.createDataURL(cell, cell * 2);
}

/** The right format for where the slide is going. */
export function qrImage(value: string, target: 'web' | 'pptx'): string {
  const v = value.trim();
  if (!v) return '';
  return target === 'pptx' ? qrGifDataUrl(v) : qrSvgDataUrl(v);
}

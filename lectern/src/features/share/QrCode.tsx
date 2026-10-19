import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code as crisp SVG. Always dark on light: inverted codes don't scan everywhere. */
export function QrCode({ value, label, className = '', level = 'M' }: { value: string; label: string; className?: string; level?: 'L' | 'M' }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, level);
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        // Join runs of dark modules into one rectangle.
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        d += `M${c + 2} ${r + 2}h${run}v1h-${run}z`;
        c += run - 1;
      }
    }
    return { size: n + 4, path: d };
  }, [value, level]);

  return (
    <svg className={`qr ${className}`} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#111" />
    </svg>
  );
}

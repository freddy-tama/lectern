// Draws a chart box as SVG, laid out the way PowerPoint draws the exported chart:
// legend on top (pie and doughnut: on the right), value axis with gridlines,
// category labels under the plot, value labels outside the marks.

import type { ChartBox } from '../../core/engine/boxes';
import { cssFont, measureText, wrapLines } from '../../core/engine/measure';
import { type Theme, fontFamily } from '../../core/engine/themes';
import { formatChartValue } from '../../core/kinds/data-kinds';

const GAP_WIDTH = 0.6;
const OVERLAP = -0.12;

export function ChartView({ box, theme }: { box: ChartBox; theme: Theme }) {
  const family = fontFamily(theme, box.font, 'web');
  const fs = box.fontSize;
  const font = cssFont(family, fs, 400);
  const width = (s: string) => measureText(s, font);
  const fmt = (v: number) => formatChartValue(v, box.unit, box.unitPosition, box.decimals ?? 0);
  const round = box.chart === 'pie' || box.chart === 'doughnut';
  const common = { fontFamily: family, fontSize: fs };
  return (
    <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} className="chart-svg" style={common} aria-hidden>
      {round ? <Round box={box} fmt={fmt} width={width} /> : <Axes box={box} fmt={fmt} width={width} font={font} />}
    </svg>
  );
}

type Fmt = (v: number) => string;
type Width = (s: string) => number;

function Legend({ box, names, colors, x, y, width, vertical, maxW }: { box: ChartBox; names: string[]; colors: string[]; x: number; y: number; width: Width; vertical?: boolean; maxW: number }) {
  const fs = box.fontSize;
  const sw = fs * 0.62;
  const gap = fs * 0.4;
  const spacing = fs * 1.4;
  if (vertical) {
    const lineH = fs * 1.55;
    return (
      <g>
        {names.map((n, i) => (
          <g key={i} transform={`translate(${x}, ${y + i * lineH})`}>
            <rect x={0} y={-sw / 2} width={sw} height={sw} rx={sw * 0.18} fill={colors[i % colors.length]} />
            <text x={sw + gap} y={0} dominantBaseline="central" fill={box.textColor}>{clip(n, maxW - sw - gap, width)}</text>
          </g>
        ))}
      </g>
    );
  }
  const items = names.map((n) => sw + gap + Math.min(width(n), maxW / 2));
  const total = items.reduce((a, b) => a + b, 0) + spacing * (items.length - 1);
  let cx = x - total / 2;
  return (
    <g>
      {names.map((n, i) => {
        const at = cx;
        cx += items[i] + spacing;
        return (
          <g key={i} transform={`translate(${at}, ${y})`}>
            <rect x={0} y={-sw / 2} width={sw} height={sw} rx={sw * 0.18} fill={colors[i % colors.length]} />
            <text x={sw + gap} y={0} dominantBaseline="central" fill={box.textColor}>{clip(n, maxW / 2, width)}</text>
          </g>
        );
      })}
    </g>
  );
}

function clip(s: string, max: number, width: Width) {
  if (width(s) <= max) return s;
  let out = s;
  while (out.length > 1 && width(`${out}…`) > max) out = out.slice(0, -1);
  return `${out}…`;
}

function Axes({ box, fmt, width, font }: { box: ChartBox; fmt: Fmt; width: Width; font: string }) {
  const fs = box.fontSize;
  const horizontal = box.chart === 'bar';
  const n = box.labels.length;
  const k = box.series.length;
  const axis = box.axis ?? { min: 0, max: 1, step: 1 };
  const ticks: number[] = [];
  for (let v = axis.min; v <= axis.max + axis.step * 1e-6; v += axis.step) ticks.push(Number(v.toPrecision(12)));
  const tickLabels = ticks.map(fmt);
  const valueColor = box.valueColor ?? box.textColor;
  const legendH = box.showLegend ? fs * 2 : 0;
  const top = legendH + fs * 0.6;
  const parts: React.ReactNode[] = [];

  if (box.showLegend) {
    parts.push(<Legend key="legend" box={box} names={box.series.map((s) => s.name)} colors={box.colors} x={box.w / 2} y={fs * 0.75} width={width} maxW={box.w} />);
  }

  if (!horizontal) {
    const axisW = Math.max(...tickLabels.map(width)) + fs * 0.6;
    const x0 = axisW;
    const x1 = box.w - fs * 0.4;
    const slot = (x1 - x0) / Math.max(1, n);
    const catLines = box.labels.map((l) => wrapLines(l, slot * 0.92, font, measureText).slice(0, 2));
    const lines = Math.max(1, ...catLines.map((l) => l.length));
    const y1 = box.h - (lines * fs * 1.2 + fs * 0.5);
    const y0 = top;
    const scale = (v: number) => y1 - ((v - axis.min) / (axis.max - axis.min || 1)) * (y1 - y0);
    const zero = scale(Math.max(axis.min, Math.min(axis.max, 0)));
    ticks.forEach((t, i) => {
      const y = scale(t);
      parts.push(<line key={`g${i}`} x1={x0} x2={x1} y1={y} y2={y} stroke={box.gridColor} strokeWidth={2} />);
      parts.push(<text key={`t${i}`} x={x0 - fs * 0.4} y={y} textAnchor="end" dominantBaseline="central" fill={box.textColor}>{tickLabels[i]}</text>);
    });
    parts.push(<line key="base" x1={x0} x2={x1} y1={zero} y2={zero} stroke={box.gridColor} strokeWidth={3} />);
    catLines.forEach((ls, i) => {
      const cx = x0 + slot * (i + 0.5);
      parts.push(
        <text key={`c${i}`} x={cx} y={y1 + fs * 0.45} textAnchor="middle" fill={box.textColor}>
          {ls.map((l, j) => <tspan key={j} x={cx} dy={j === 0 ? fs * 0.85 : fs * 1.2}>{l}</tspan>)}
        </text>,
      );
    });
    if (box.chart === 'column') {
      const group = slot / (1 + GAP_WIDTH);
      const bw = group / (k - (k - 1) * OVERLAP);
      box.series.forEach((s, si) => s.values.forEach((v, i) => {
        const x = x0 + slot * i + (slot - group) / 2 + si * bw * (1 - OVERLAP);
        const y = scale(v);
        const yTop = Math.min(y, zero);
        const h = Math.abs(zero - y);
        parts.push(<rect key={`b${si}-${i}`} x={x} y={yTop} width={bw} height={Math.max(h, 0)} fill={box.colors[si % box.colors.length]} />);
        if (box.showValues) {
          parts.push(<text key={`v${si}-${i}`} x={x + bw / 2} y={v >= 0 ? y - fs * 0.45 : y + fs * 0.45} textAnchor="middle" dominantBaseline={v >= 0 ? 'auto' : 'hanging'} fill={valueColor}>{fmt(v)}</text>);
        }
      }));
    } else {
      box.series.forEach((s, si) => {
        const color = box.colors[si % box.colors.length];
        const pts = s.values.map((v, i) => [x0 + slot * (i + 0.5), scale(v)] as const);
        parts.push(<polyline key={`l${si}`} points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />);
        pts.forEach(([x, y], i) => {
          parts.push(<circle key={`p${si}-${i}`} cx={x} cy={y} r={8} fill={color} stroke={box.edgeColor ?? 'none'} strokeWidth={2} />);
          if (box.showValues) parts.push(<text key={`v${si}-${i}`} x={x} y={y - fs * 0.7} textAnchor="middle" fill={valueColor}>{fmt(s.values[i])}</text>);
        });
      });
    }
    return <g>{parts}</g>;
  }

  // Bars: categories down the left, values along the bottom.
  const catW = Math.min(box.w * 0.32, Math.max(...box.labels.map(width), fs) + fs * 0.8);
  const valueW = box.showValues ? Math.max(...box.series.flatMap((s) => s.values.map((v) => width(fmt(v))))) + fs * 0.6 : fs * 0.6;
  const x0 = catW;
  const x1 = box.w - Math.max(valueW, width(tickLabels[tickLabels.length - 1]) / 2);
  const y0 = top;
  const y1 = box.h - fs * 1.6;
  const slot = (y1 - y0) / Math.max(1, n);
  const scale = (v: number) => x0 + ((v - axis.min) / (axis.max - axis.min || 1)) * (x1 - x0);
  const zero = scale(Math.max(axis.min, Math.min(axis.max, 0)));
  ticks.forEach((t, i) => {
    const x = scale(t);
    parts.push(<line key={`g${i}`} x1={x} x2={x} y1={y0} y2={y1} stroke={box.gridColor} strokeWidth={2} />);
    parts.push(<text key={`t${i}`} x={x} y={y1 + fs * 0.5} textAnchor="middle" dominantBaseline="hanging" fill={box.textColor}>{tickLabels[i]}</text>);
  });
  parts.push(<line key="base" x1={zero} x2={zero} y1={y0} y2={y1} stroke={box.gridColor} strokeWidth={3} />);
  box.labels.forEach((l, i) => {
    parts.push(<text key={`c${i}`} x={x0 - fs * 0.4} y={y0 + slot * (i + 0.5)} textAnchor="end" dominantBaseline="central" fill={box.textColor}>{clip(l, catW - fs * 0.6, width)}</text>);
  });
  const group = slot / (1 + GAP_WIDTH);
  const bh = group / (k - (k - 1) * OVERLAP);
  box.series.forEach((s, si) => s.values.forEach((v, i) => {
    // PowerPoint stacks the first series lowest within each group.
    const y = y0 + slot * i + (slot - group) / 2 + (k - 1 - si) * bh * (1 - OVERLAP);
    const x = scale(v);
    parts.push(<rect key={`b${si}-${i}`} x={Math.min(x, zero)} y={y} width={Math.abs(x - zero)} height={bh} fill={box.colors[si % box.colors.length]} />);
    if (box.showValues) {
      parts.push(<text key={`v${si}-${i}`} x={v >= 0 ? x + fs * 0.35 : x - fs * 0.35} y={y + bh / 2} textAnchor={v >= 0 ? 'start' : 'end'} dominantBaseline="central" fill={valueColor}>{fmt(v)}</text>);
    }
  }));
  return <g>{parts}</g>;
}

function Round({ box, fmt, width }: { box: ChartBox; fmt: Fmt; width: Width }) {
  const fs = box.fontSize;
  const values = (box.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0);
  const legendW = box.showLegend ? Math.min(box.w * 0.38, Math.max(0, ...box.labels.map(width)) + fs * 1.4) : 0;
  const plotW = box.w - legendW - (legendW ? fs * 1.5 : 0);
  const r = Math.min(plotW, box.h) / 2 * 0.94;
  const cx = plotW / 2;
  const cy = box.h / 2;
  const inner = box.chart === 'doughnut' ? r * 0.55 : 0;
  const parts: React.ReactNode[] = [];
  if (total <= 0) {
    parts.push(<circle key="empty" cx={cx} cy={cy} r={r - fs * 0.3} fill="none" stroke={box.gridColor} strokeWidth={fs * 0.6} />);
  } else {
    let angle = 0;
    values.forEach((v, i) => {
      if (v <= 0) return;
      const sweep = (v / total) * Math.PI * 2;
      const color = box.colors[i % box.colors.length];
      const a0 = angle;
      const a1 = angle + sweep;
      angle = a1;
      const at = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
      if (sweep >= Math.PI * 2 - 1e-6) {
        parts.push(inner
          ? <circle key={`s${i}`} cx={cx} cy={cy} r={(r + inner) / 2} fill="none" stroke={color} strokeWidth={r - inner} />
          : <circle key={`s${i}`} cx={cx} cy={cy} r={r} fill={color} />);
      } else {
        const large = sweep > Math.PI ? 1 : 0;
        const [ox0, oy0] = at(r, a0);
        const [ox1, oy1] = at(r, a1);
        let d = `M ${ox0} ${oy0} A ${r} ${r} 0 ${large} 1 ${ox1} ${oy1}`;
        if (inner) {
          const [ix1, iy1] = at(inner, a1);
          const [ix0, iy0] = at(inner, a0);
          d += ` L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`;
        } else d += ` L ${cx} ${cy} Z`;
        parts.push(<path key={`s${i}`} d={d} fill={color} stroke={box.edgeColor ?? 'none'} strokeWidth={4} strokeLinejoin="round" />);
      }
      if (box.showValues) {
        const mid = (a0 + a1) / 2;
        const [lx, ly] = at(inner ? (r + inner) / 2 : r * 0.62, mid);
        parts.push(<text key={`v${i}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fill={box.insideColor ?? box.valueColor ?? box.textColor} fontWeight={600}>{fmt(v)}</text>);
      }
    });
  }
  if (box.showLegend) {
    const lineH = fs * 1.55;
    const y = cy - ((box.labels.length - 1) * lineH) / 2;
    parts.push(<Legend key="legend" box={box} names={box.labels} colors={box.colors} x={box.w - legendW} y={y} width={width} vertical maxW={legendW} />);
  }
  return <g>{parts}</g>;
}

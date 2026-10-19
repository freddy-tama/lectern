// Draws a table box as positioned cells, matching the exported PowerPoint table:
// a filled header row, optional stripes, and a hairline under every row.

import type { TableBox } from '../../core/engine/boxes';
import { type Theme, fontFamily } from '../../core/engine/themes';

export function TableView({ box, theme }: { box: TableBox; theme: Theme }) {
  const padX = box.padX ?? Math.round(box.fontSize * 0.65);
  const padY = box.padY ?? Math.round(box.fontSize * 0.42);
  const family = fontFamily(theme, box.font, 'web');
  const cells: React.ReactNode[] = [];
  let y = 0;
  box.rows.forEach((row, i) => {
    const h = box.rowHeights[i] ?? 0;
    const head = box.header && i === 0;
    const bodyIndex = box.header ? i - 1 : i;
    const fill = head ? box.headerFill : box.stripeFill && bodyIndex % 2 === 1 ? box.stripeFill : undefined;
    if (fill) cells.push(<div key={`f${i}`} className="table-fill" style={{ top: y, height: h, background: fill }} />);
    let x = 0;
    row.forEach((cell, j) => {
      const w = box.colWidths[j] ?? 0;
      const align = box.align?.[j] ?? 'left';
      cells.push(
        <div
          key={`${i}-${j}`}
          className="table-cell"
          style={{
            left: x, top: y, width: w, height: h, padding: `${padY}px ${padX}px`,
            color: head ? box.headerText : box.textColor,
            fontWeight: head ? box.headerWeight ?? 700 : box.weight ?? 400,
            textAlign: align,
            justifyContent: 'center',
          }}
        >
          <span>{cell}</span>
        </div>,
      );
      x += w;
    });
    y += h;
    if (!head) cells.push(<div key={`l${i}`} className="table-line" style={{ top: y - 1, background: box.lineColor }} />);
  });
  return (
    <div className="table-view" style={{ fontFamily: family, fontSize: box.fontSize, lineHeight: box.lineHeight ?? 1.25 }}>
      {cells}
    </div>
  );
}

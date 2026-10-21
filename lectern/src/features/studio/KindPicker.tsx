import { allKinds } from '../../core/kinds/registry';
import type { KindGroup } from '../../core/kinds/types';
import { KindIcon } from '../../ui/KindIcon';

const GROUPS: { id: KindGroup; label: string }[] = [
  { id: 'Open', label: 'Open' },
  { id: 'Explain', label: 'Explain' },
  { id: 'Data', label: 'Data' },
  { id: 'Visual', label: 'Pictures and diagrams' },
  { id: 'Media', label: 'Video and the web' },
  { id: 'Engage', label: 'Engage the audience' },
  { id: 'Close', label: 'Close' },
];

/** The list of slide kinds, grouped by what they do in a deck. */
export function KindPicker({ onPick, current }: { onPick(kind: string): void; current?: string }) {
  const kinds = allKinds();
  return (
    <div className="kind-picker">
      {GROUPS.map((g) => {
        const items = kinds.filter((k) => k.group === g.id);
        if (!items.length) return null;
        return (
          <div key={g.id} className="kind-group">
            <div className="menu-label eyebrow">{g.label}</div>
            {items.map((k) => (
              <button key={k.kind} type="button" className="menu-item kind-item" onClick={() => onPick(k.kind)} aria-current={current === k.kind ? 'true' : undefined}>
                <span className="kind-icon"><KindIcon name={k.icon} size={16} /></span>
                <span>
                  {k.label}
                  {k.plugin && <span className="chip" style={{ height: 18, marginLeft: 6, fontSize: 11 }}>{k.plugin}</span>}
                  <span className="menu-detail">{k.description}</span>
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

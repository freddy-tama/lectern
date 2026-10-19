import { X } from 'lucide-react';
import { toggles } from '../../core/plugins/registry';

const KEYS: [string[], string][] = [
  [['→', 'Space'], 'Next step or slide'],
  [['←'], 'Back'],
  [['Home', 'End'], 'First or last slide'],
  [['3', 'Enter'], 'Go to slide 3'],
  [['B'], 'Blank the screen'],
  [['N'], 'Key notes'],
  [['F'], 'Full screen'],
  [['Esc'], 'Leave'],
];

export function HelpOverlay({ onClose, extra = [], base = true }: { onClose(): void; extra?: [string[], string][]; base?: boolean }) {
  const mods: [string[], string][] = toggles().map((t) => [[t.key.toUpperCase()], t.label]);
  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <dl>
          {[...(base ? KEYS : []), ...extra, ...(base ? mods : [])].map(([keys, label]) => (
            <div key={label}>
              <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <p className="faint">Clickers that send arrow or page keys work too.</p>
      </div>
    </div>
  );
}

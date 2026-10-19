import { Frown, type LucideIcon, Meh, Smile } from 'lucide-react';
import type { NoteMood } from '../../data/db';

export const MOODS: { id: NoteMood; label: string; Icon: LucideIcon }[] = [
  { id: 'great', label: 'Went well', Icon: Smile },
  { id: 'okay', label: 'Okay', Icon: Meh },
  { id: 'rough', label: 'Rough', Icon: Frown },
];

export function moodLabel(mood: NoteMood): string {
  return MOODS.find((m) => m.id === mood)?.label ?? mood;
}

export function MoodIcon({ mood, size = 15 }: { mood: NoteMood; size?: number }) {
  const m = MOODS.find((x) => x.id === mood);
  if (!m) return null;
  return (
    <span className={`nt-mood-icon is-${mood}`} title={m.label}>
      <m.Icon size={size} aria-hidden />
      <span className="visually-hidden">{m.label}</span>
    </span>
  );
}

/** Three buttons: went well, okay, rough. Pressing the chosen one again clears it. */
export function MoodPicker({ value, onChange, label = 'How did it go?', compact }: { value?: NoteMood; onChange(mood: NoteMood | undefined): void; label?: string; compact?: boolean }) {
  return (
    <div className={`nt-moods ${compact ? 'is-compact' : ''}`} role="group" aria-label={label}>
      {MOODS.map(({ id, label: name, Icon }) => (
        <button
          key={id}
          type="button"
          className={`nt-mood is-${id}`}
          aria-pressed={value === id}
          onClick={() => onChange(value === id ? undefined : id)}
        >
          <Icon size={compact ? 15 : 17} aria-hidden /> {name}
        </button>
      ))}
    </div>
  );
}

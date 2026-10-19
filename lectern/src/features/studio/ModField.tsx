import type { NotesField } from '../../core/plugins/api';

/** One field a mod added, drawn as a select, an input or a textarea. */
export function ModField({ field, value, onChange }: { field: NotesField; value: string; onChange(value: string): void }) {
  let control;
  if (field.options?.length) {
    control = (
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{field.emptyOption ?? 'Not set'}</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        {value && !field.options.includes(value) && <option value={value}>{value}</option>}
      </select>
    );
  } else if (field.rows === 1) {
    control = <input className="input" value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = <textarea className="textarea" rows={field.rows ?? 2} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <label className="field">
      <span className="field-label">{field.label}</span>
      {control}
      {field.help && <span className="field-help">{field.help}</span>}
    </label>
  );
}

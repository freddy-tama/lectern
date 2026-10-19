import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { allTags, normalizeTags, parseTags } from '../../data/notes';

/** Tag chips with a text box: Enter, comma or space adds; Backspace in an empty box removes the last one. */
export function TagEditor({ tags, onChange, id }: { tags: string[]; onChange(tags: string[]): void; id?: string }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const known = useLiveQuery(allTags, []);
  const add = (text: string) => {
    const next = normalizeTags([...tags, ...parseTags(text)]);
    if (next.length !== tags.length) onChange(next);
    setDraft('');
  };
  return (
    <div className="nt-tags-edit" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {tags.map((t) => (
        <span key={t} className="nt-tag is-removable">
          #{t}
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(tags.filter((x) => x !== t)); }} aria-label={`Remove tag ${t}`}><X size={12} /></button>
        </span>
      ))}
      <input
        id={id}
        className="nt-tags-input"
        value={draft}
        list={listId}
        placeholder={tags.length ? 'Add tag' : 'Add tags, like planning'}
        onChange={(e) => {
          const v = e.target.value;
          if (/[\s,]$/.test(v) && v.trim()) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) add(draft); }
          else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        aria-label="Add a tag"
      />
      <datalist id={listId}>
        {known?.filter((k) => !tags.includes(k.tag)).slice(0, 30).map((k) => <option key={k.tag} value={k.tag} />)}
      </datalist>
    </div>
  );
}

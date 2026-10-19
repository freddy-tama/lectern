// A link chip from a note to the recording it was made from.

import { useLiveQuery } from 'dexie-react-hooks';
import { AudioLines } from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '../../data/db';

export function RecordingLink({ id }: { id?: string }) {
  const rec = useLiveQuery(() => (id ? db.recordings.get(id) : undefined), [id]);
  if (!rec) return null;
  return (
    <Link className="nt-link" to={`/recordings/${rec.id}`} title="Open the recording">
      <AudioLines size={14} /><span className="nt-link-text">{rec.title}</span>
    </Link>
  );
}

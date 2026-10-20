import { Upload, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dragHasFiles, handOffFiles } from './handoff';
import { ACCEPT_ALL } from './make';
import '../../styles/autodeck.css';

/**
 * A drop target on the home page. Dropped or chosen files go straight to the deck maker,
 * which starts reading them at once.
 */
export function QuickMake({ hero, title, detail }: { hero?: boolean; title?: string; detail?: string }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const go = (files: File[]) => {
    handOffFiles(files);
    navigate('/make');
  };
  return (
    <div
      className={`qm ${hero ? 'qm-hero' : ''} ${dragging ? 'is-dragging' : ''}`}
      role="group"
      aria-label="Make a deck from files"
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, input')) input.current?.click(); }}
      onDragOver={(e) => { if (dragHasFiles(e)) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => { if (!dragHasFiles(e)) return; e.preventDefault(); setDragging(false); go(Array.from(e.dataTransfer.files)); }}
    >
      <span className="qm-art" aria-hidden>{hero ? <Upload size={26} /> : <Wand2 size={20} />}</span>
      <span className="qm-text">
        <strong>{title ?? (hero ? 'Drop your files here' : 'Make a deck from your files')}</strong>
        <span>{detail ?? 'PDF, Word, PowerPoint, Excel, pictures or a recording. Lectern asks a few questions, then writes the slides.'}</span>
      </span>
      {hero ? (
        <span className="qm-actions">
          <button type="button" className="btn btn-brand btn-lg" onClick={() => input.current?.click()}><Upload size={17} /> Choose files</button>
          <button type="button" className="btn btn-secondary btn-lg" onClick={() => navigate('/make')}><Wand2 size={17} /> Describe a topic instead</button>
        </span>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()}><Upload size={15} /> Choose files</button>
      )}
      <input ref={input} type="file" multiple accept={ACCEPT_ALL} hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) go(files); }} />
    </div>
  );
}

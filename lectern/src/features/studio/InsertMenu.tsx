import { Circle, ImagePlus, Minus, PenTool, Plus, Search, Sparkle, Square, Type } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { type SlideElement, uid } from '../../core/deck/types';
import { CANVAS_H, CANVAS_W } from '../../core/engine/boxes';
import { DECOR_MOTIFS, type DecorMotif, decorDataUrl } from '../../core/engine/decor';
import { centred } from '../../core/engine/elements';
import type { Theme } from '../../core/engine/themes';
import { assetUrl } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import type { PictureSlideContext } from '../pictures/context';
import { PictureFinder } from '../pictures/PictureFinder';
import { savePicture } from '../pictures/store';
import { DrawPanel } from './MediaFields';

// Insert: put a picture, a drawing, a text box, a shape or a decoration anywhere on any slide.
// What it adds is a free element (see src/core/engine/elements.ts) that can be dragged, resized and deleted.

/** A picture's place on the slide: centred, as wide as suits it, in its own proportions. */
export async function pictureElement(src: string, alt = ''): Promise<SlideElement> {
  const aspect = await aspectOf(src).catch(() => 4 / 3);
  const w = aspect >= 1 ? 720 : Math.round(560 * aspect);
  const h = Math.round(w / aspect);
  return { id: uid('e'), type: 'picture', src, fit: 'contain', ...(alt ? { alt } : {}), ...centred(Math.min(w, CANVAS_W - 200), Math.min(h, CANVAS_H - 160)) };
}

async function aspectOf(src: string): Promise<number> {
  const url = await assetUrl(src);
  if (!url) return 4 / 3;
  const img = new Image();
  img.src = url;
  await img.decode();
  return img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 4 / 3;
}

export function textElement(): SlideElement {
  return { id: uid('e'), type: 'text', text: 'Text', size: 48, ...centred(640, 120) };
}

export function shapeElement(shape: 'rect' | 'ellipse' | 'line'): SlideElement {
  if (shape === 'line') return { id: uid('e'), type: 'shape', shape, stroke: 'accent', strokeWidth: 6, ...centred(560, 0) };
  return { id: uid('e'), type: 'shape', shape, fill: 'accent2', ...(shape === 'rect' ? { radius: 24 } : {}), ...centred(shape === 'ellipse' ? 360 : 520, shape === 'ellipse' ? 360 : 300) };
}

/**
 * A decoration at its natural shape, where it is drawn to sit: bands along the bottom edge, the rest in the
 * top-right corner, out of the way of the content.
 */
export function decorElement(motif: DecorMotif, aspect: number): SlideElement {
  const base = { id: uid('e'), type: 'decor' as const, motif, layer: 'back' as const, seed: Math.floor(Math.random() * 9999) + 1 };
  if (aspect >= 3) {
    const h = Math.round(CANVAS_W / aspect);
    return { ...base, x: 0, y: CANVAS_H - h, w: CANVAS_W, h };
  }
  const w = aspect >= 1.4 ? 560 : 420;
  const h = Math.min(CANVAS_H, Math.round(w / aspect));
  return { ...base, x: CANVAS_W - w, y: 0, w, h };
}

export function InsertMenu({ theme, context, onInsert }: {
  theme: Theme;
  context: PictureSlideContext | null;
  onInsert(el: SlideElement, note?: string): void;
}) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [decor, setDecor] = useState(false);

  const place = async (ref: string, note?: string, alt?: string) => onInsert(await pictureElement(ref, alt), note);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast.show('Choose a picture file: JPEG, PNG, WebP, GIF or SVG.', { tone: 'error' }); return; }
    if (f.size > 12 * 1024 * 1024) { toast.show('This picture is over 12 MB. Choose a smaller one.', { tone: 'error' }); return; }
    await place(await savePicture(f, f.name, { source: 'upload', rights: 'own' }), undefined, f.name.replace(/\.[^.]+$/, ''));
  };

  return (
    <>
      <Menu width={260} trigger={(p) => <button type="button" className="btn btn-ghost btn-sm" title="Put a picture, a drawing, text, a shape or a decoration anywhere on this slide" {...p}><Plus size={15} /> Insert</button>}>
        {(close) => (
          <>
            <button type="button" className="menu-item" onClick={() => { close(); file.current?.click(); }}><ImagePlus size={16} /><span>Picture from this computer</span></button>
            <button type="button" className="menu-item" onClick={() => { close(); setFinding(true); }}><Search size={16} /><span>Find a picture<span className="menu-detail">Free photos, a link, or AI</span></span></button>
            <button type="button" className="menu-item" onClick={() => { close(); setDrawing(true); }}><PenTool size={16} /><span>Drawing<span className="menu-detail">AI draws an SVG, or paste your own</span></span></button>
            <div className="menu-sep" role="separator" />
            <button type="button" className="menu-item" onClick={() => { close(); onInsert(textElement()); }}><Type size={16} /><span>Text box</span></button>
            <button type="button" className="menu-item" onClick={() => { close(); onInsert(shapeElement('rect')); }}><Square size={16} /><span>Rectangle</span></button>
            <button type="button" className="menu-item" onClick={() => { close(); onInsert(shapeElement('ellipse')); }}><Circle size={16} /><span>Circle</span></button>
            <button type="button" className="menu-item" onClick={() => { close(); onInsert(shapeElement('line')); }}><Minus size={16} /><span>Line</span></button>
            <button type="button" className="menu-item" onClick={() => { close(); setDecor(true); }}><Sparkle size={16} /><span>Decoration<span className="menu-detail">Waves, confetti, leaves and more, in this look’s colours</span></span></button>
          </>
        )}
      </Menu>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      <PictureFinder
        open={finding}
        onClose={() => setFinding(false)}
        query={context?.heading ?? ''}
        suggestions={context?.deckTitle && context.deckTitle !== context.heading ? [context.deckTitle] : []}
        shape="wide"
        context={context}
        onPick={(ref, note) => { setFinding(false); void place(ref, note); }}
      />
      <Dialog open={drawing} onClose={() => setDrawing(false)} title="Add a drawing" description="It goes on this slide, and you can move and resize it.">
        {drawing && (
          <DrawPanel
            shape="wide"
            suggestion={context?.heading ?? ''}
            onClose={() => setDrawing(false)}
            onDone={(ref, note) => { setDrawing(false); void place(ref, note); }}
          />
        )}
      </Dialog>
      <DecorPicker open={decor} theme={theme} onClose={() => setDecor(false)} onPick={(m, aspect) => { setDecor(false); onInsert(decorElement(m, aspect)); }} />
    </>
  );
}

/** Every decoration, drawn in the deck's colours. */
function DecorPicker({ open, theme, onClose, onPick }: { open: boolean; theme: Theme; onClose(): void; onPick(motif: DecorMotif, aspect: number): void }) {
  const c = theme.colors;
  const previews = useMemo(
    () => (open ? DECOR_MOTIFS.map((m) => ({ ...m, url: decorDataUrl(m.id, { a: c.accent, b: c.accent2, c: c.muted }, Math.round(160 * Math.min(2, m.aspect)), 160, 7) })) : []),
    [open, c.accent, c.accent2, c.muted],
  );
  return (
    <Dialog open={open} onClose={onClose} title="Add a decoration" description="It goes behind the slide’s content. Drag it to a corner or an edge and resize it.">
      <div className="decor-grid">
        {previews.map((m) => (
          <button key={m.id} type="button" className="decor-option" onClick={() => onPick(m.id, m.aspect)} title={m.description} style={{ background: c.bg }}>
            <img src={m.url} alt="" />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}


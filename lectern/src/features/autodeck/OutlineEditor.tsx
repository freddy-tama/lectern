// The plan of a deck, before its slides are written: rename, reorder, retype, add and remove
// slides, and choose which pictures go where. "Write the slides" approves it.

import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, ImagePlus, MoreHorizontal, Plus, Trash2, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '../../core/deck/types';
import { allKinds, getKind } from '../../core/kinds/registry';
import type { AnyKind } from '../../core/kinds/types';
import type { DraftJob, PlannedSlide } from '../../data/draft-jobs';
import { KindIcon } from '../../ui/KindIcon';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { MAX_OUTLINE, outlineMinutes, pictureRoom, withKind } from './outline';

interface Props {
  job: DraftJob;
  /** Object URLs of the job's pictures: the first is "pic1". */
  pictureUrls: string[];
  onChange(title: string, outline: PlannedSlide[]): void;
  onWrite(title: string, outline: PlannedSlide[]): void;
  onDiscard(): void;
}

export function OutlineEditor({ job, pictureUrls, onChange, onWrite, onDiscard }: Props) {
  const toast = useToast();
  const plan = job.decks[0]!;
  const [title, setTitle] = useState(plan.title);
  const [slides, setSlides] = useState<PlannedSlide[]>(plan.outline);
  const [focusId, setFocusId] = useState<string | null>(null);
  const first = useRef(true);

  // Edits are saved as they're made, so the outline is still here after a visit elsewhere.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = window.setTimeout(() => onChange(title, slides), 400);
    return () => window.clearTimeout(t);
  }, [title, slides, onChange]);

  const kinds = useMemo(() => {
    const offered = new Set((job.request.kinds as { kind?: string }[]).map((k) => k.kind));
    return allKinds().filter((k) => offered.has(k.kind));
  }, [job.request.kinds]);
  const pictures = pictureUrls.map((url, i) => ({ id: `pic${i + 1}`, url, name: job.pictures[i]?.name ?? `Picture ${i + 1}` }));
  const used = new Set(slides.flatMap((s) => s.pictures));
  const total = outlineMinutes(slides);
  const target = job.request.minutes;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = slides.findIndex((s) => s.id === e.active.id);
    const to = slides.findIndex((s) => s.id === e.over!.id);
    if (from >= 0 && to >= 0) setSlides(arrayMove(slides, from, to));
  };

  const update = (id: string, patch: Partial<PlannedSlide>) => setSlides((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (from: number, to: number) => { if (to >= 0 && to < slides.length) setSlides(arrayMove(slides, from, to)); };
  const add = (at: number) => {
    const kind = kinds.find((k) => k.kind === 'bullets') ?? kinds[0];
    if (!kind || slides.length >= MAX_OUTLINE) return;
    const slide: PlannedSlide = { id: uid('o'), title: '', kind: kind.kind, minutes: 2, point: '', pictures: [] };
    setSlides((all) => [...all.slice(0, at), slide, ...all.slice(at)]);
    setFocusId(slide.id);
  };
  const remove = (index: number) => {
    const before = slides;
    const gone = slides[index]!;
    setSlides(slides.filter((_, i) => i !== index));
    toast.show(`Removed “${gone.title || `slide ${index + 1}`}”`, { action: { label: 'Undo', run: () => setSlides(before) } });
  };

  const minutesNote = Math.abs(total - target) < Math.max(2, target * 0.1)
    ? `about ${Math.round(total)} min`
    : total > target ? `${Math.round(total)} min, ${Math.round(total - target)} over your ${target}` : `${Math.round(total)} min, ${Math.round(target - total)} under your ${target}`;

  return (
    <section className="ol" aria-labelledby="ol-title">
      <header className="ol-head">
        <p className="eyebrow">Make a deck · Outline</p>
        <label className="visually-hidden" htmlFor="ol-title">Deck title</label>
        <input id="ol-title" className="ol-deck-title display" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled deck" maxLength={200} />
        <p className="muted ol-lead">Check the plan before Lectern writes the slides and speaker notes. Rename, reorder, change or add slides.</p>
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="ol-list" aria-label="Outline">
            {slides.map((s, i) => (
              <OutlineRow
                key={s.id}
                slide={s}
                number={i + 1}
                count={slides.length}
                kinds={kinds}
                pictures={pictures}
                used={used}
                autoFocus={focusId === s.id}
                onChange={(patch) => update(s.id, patch)}
                onKind={(kind) => update(s.id, withKind(s, kind))}
                onMove={(to) => move(i, to)}
                onAddBelow={() => add(i + 1)}
                onRemove={() => remove(i)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {!slides.length && <p className="ol-empty muted">No slides left. Add one to write the deck.</p>}
      <button type="button" className="btn btn-ghost ol-add" onClick={() => add(slides.length)} disabled={slides.length >= MAX_OUTLINE}>
        <Plus size={16} /> Add a slide
      </button>

      <div className="ol-foot">
        <button type="button" className="btn btn-ghost" onClick={onDiscard}>Start over</button>
        <span className="ol-total tabular" aria-live="polite">{slides.length} slide{slides.length === 1 ? '' : 's'} · {minutesNote}</span>
        <button type="button" className="btn btn-brand btn-lg" onClick={() => onWrite(title, slides)} disabled={!slides.length}>
          <Wand2 size={17} /> Write the slides
        </button>
      </div>
    </section>
  );
}

interface RowProps {
  slide: PlannedSlide;
  number: number;
  count: number;
  kinds: AnyKind[];
  pictures: { id: string; url: string; name: string }[];
  used: Set<string>;
  autoFocus: boolean;
  onChange(patch: Partial<PlannedSlide>): void;
  onKind(kind: string): void;
  onMove(to: number): void;
  onAddBelow(): void;
  onRemove(): void;
}

function OutlineRow({ slide, number, count, kinds, pictures, used, autoFocus, onChange, onKind, onMove, onAddBelow, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) titleRef.current?.focus(); }, [autoFocus]);
  const def = getKind(slide.kind);
  const room = def ? pictureRoom(def) : 0;
  const free = pictures.filter((p) => !used.has(p.id));
  const shown = pictures.filter((p) => slide.pictures.includes(p.id));
  return (
    <li
      ref={setNodeRef}
      className={`ol-row ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="ol-grip"
        aria-label={`Move slide ${number}. Press space, then the arrow keys.`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <span className="ol-num tabular" aria-hidden>{number}</span>
      <div className="ol-body">
        <input
          ref={titleRef}
          className="input-bare ol-title"
          value={slide.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Heading (the AI writes one if you leave it empty)"
          aria-label={`Slide ${number} heading`}
          maxLength={200}
        />
        <input
          className="input-bare ol-point"
          value={slide.point}
          onChange={(e) => onChange({ point: e.target.value })}
          placeholder="What this slide gets across"
          aria-label={`Slide ${number} point`}
          maxLength={300}
        />
        <div className="ol-meta">
          <label className="ol-kind">
            <KindIcon name={def?.icon ?? 'square'} size={14} />
            <select value={slide.kind} onChange={(e) => onKind(e.target.value)} aria-label={`Slide ${number} type`}>
              {!def && <option value={slide.kind}>{slide.kind}</option>}
              {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          <label className="ol-minutes">
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={slide.minutes}
              onChange={(e) => onChange({ minutes: Math.max(0.5, Math.min(30, Number(e.target.value) || 0.5)) })}
              aria-label={`Slide ${number} minutes`}
            />
            <span aria-hidden>min</span>
          </label>
          {shown.map((p) => (
            <span key={p.id} className="ol-pic">
              <img src={p.url} alt="" />
              <button type="button" onClick={() => onChange({ pictures: slide.pictures.filter((id) => id !== p.id) })} aria-label={`Take ${p.name} off slide ${number}`}>
                <X size={12} />
              </button>
            </span>
          ))}
          {room > slide.pictures.length && free.length > 0 && (
            <Menu
              width={240}
              trigger={(t) => <button type="button" className="ol-pic-add" aria-label={`Add a picture to slide ${number}`} {...t}><ImagePlus size={14} /> Picture</button>}
            >
              {(close) => free.map((p) => (
                <button key={p.id} type="button" className="menu-item ol-pic-option" onClick={() => { close(); onChange({ pictures: [...slide.pictures, p.id] }); }}>
                  <img src={p.url} alt="" /> <span>{p.name}</span>
                </button>
              ))}
            </Menu>
          )}
        </div>
      </div>
      <Menu align="end" trigger={(t) => <button type="button" className="icon-btn" aria-label={`More for slide ${number}`} {...t}><MoreHorizontal size={16} /></button>}>
        {(close) => (
          <>
            <button type="button" className="menu-item" onClick={() => { close(); onAddBelow(); }}><Plus size={16} /> Add a slide below</button>
            <button type="button" className="menu-item" disabled={number === 1} onClick={() => { close(); onMove(number - 2); }}><ArrowUp size={16} /> Move up</button>
            <button type="button" className="menu-item" disabled={number === count} onClick={() => { close(); onMove(number); }}><ArrowDown size={16} /> Move down</button>
            <div className="menu-sep" />
            <button type="button" className="menu-item btn-danger" onClick={() => { close(); onRemove(); }}><Trash2 size={16} /> Remove slide</button>
          </>
        )}
      </Menu>
    </li>
  );
}

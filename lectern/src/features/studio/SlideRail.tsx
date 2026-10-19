import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, EyeOff, Eye, MoreHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Deck, Slide } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';
import { Menu } from '../../ui/Menu';
import { SlideView } from '../slides/SlideView';

interface RailProps {
  deck: Deck;
  selectedId: string;
  onSelect(id: string): void;
  onReorder(slides: Slide[]): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
  onToggleHidden(id: string): void;
  footer: React.ReactNode;
}

export function SlideRail({ deck, selectedId, onSelect, onReorder, onDuplicate, onDelete, onToggleHidden, footer }: RailProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = deck.slides.findIndex((s) => s.id === e.active.id);
    const to = deck.slides.findIndex((s) => s.id === e.over!.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(deck.slides, from, to));
  };
  let visibleNumber = 0;
  return (
    <nav className="rail" aria-label="Slides">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={deck.slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="rail-list">
            {deck.slides.map((s) => {
              if (!s.hidden) visibleNumber += 1;
              return (
                <RailItem
                  key={s.id}
                  slide={s}
                  deck={deck}
                  number={s.hidden ? null : visibleNumber}
                  selected={s.id === selectedId}
                  onSelect={() => onSelect(s.id)}
                  onDuplicate={() => onDuplicate(s.id)}
                  onDelete={() => onDelete(s.id)}
                  onToggleHidden={() => onToggleHidden(s.id)}
                  canDelete={deck.slides.length > 1}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="rail-foot">{footer}</div>
    </nav>
  );
}

function RailItem({ slide, deck, number, selected, onSelect, onDuplicate, onDelete, onToggleHidden, canDelete }: {
  slide: Slide; deck: Deck; number: number | null; selected: boolean; canDelete: boolean;
  onSelect(): void; onDuplicate(): void; onDelete(): void; onToggleHidden(): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const def = getKind(slide.kind);
  const heading = def ? def.heading(slide.content) : slide.kind;
  return (
    <li
      ref={(el) => { setNodeRef(el); ref.current = el; }}
      className={`rail-item ${selected ? 'is-selected' : ''} ${slide.hidden ? 'is-hidden-slide' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="rail-num tabular" aria-hidden>{number ?? '–'}</span>
      <button
        type="button"
        className="rail-thumb"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={`Slide ${number ?? '(hidden)'}: ${def?.label ?? slide.kind}, ${heading}`}
        {...attributes}
        {...listeners}
      >
        <SlideView slide={slide} deck={deck} number={number ?? 0} count={deck.slides.length} framed />
        {slide.hidden && <span className="rail-badge"><EyeOff size={12} /> Hidden</span>}
      </button>
      <div className="rail-menu">
        <Menu align="start" trigger={(p) => <button type="button" className="icon-btn" aria-label={`Actions for slide ${number ?? ''}`} {...p}><MoreHorizontal size={16} /></button>}>
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { close(); onDuplicate(); }}><Copy size={16} /> Duplicate <kbd>Ctrl D</kbd></button>
              <button type="button" className="menu-item" onClick={() => { close(); onToggleHidden(); }}>{slide.hidden ? <Eye size={16} /> : <EyeOff size={16} />} {slide.hidden ? 'Show in presentation' : 'Hide when presenting'}</button>
              <div className="menu-sep" />
              <button type="button" className="menu-item btn-danger" disabled={!canDelete} onClick={() => { close(); onDelete(); }}><Trash2 size={16} /> Delete <kbd>Del</kbd></button>
            </>
          )}
        </Menu>
      </div>
    </li>
  );
}

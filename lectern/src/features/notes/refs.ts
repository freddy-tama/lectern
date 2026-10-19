// Live lookups the notes UI needs to show what a note links to.

import { useLiveQuery } from 'dexie-react-hooks';
import { type DeckPurpose, type Slide, deckPurpose } from '../../core/deck/types';
import { registerCoreKinds } from '../../core/kinds/core-kinds';
import { getKind } from '../../core/kinds/registry';
import { type Course, type Lesson, db } from '../../data/db';

// Slide headings come from the kind registry. Registering is idempotent.
registerCoreKinds();

export interface SlideRef {
  id: string;
  /** 1-based position among all slides in the deck. */
  number: number;
  heading: string;
  hidden?: boolean;
}

export interface DeckRef {
  id: string;
  title: string;
  lessonId?: string;
  purpose: DeckPurpose;
  slides: SlideRef[];
  updatedAt: number;
}

export interface NoteRefs {
  courses: Course[];
  lessons: Lesson[];
  decks: DeckRef[];
  course: Map<string, Course>;
  lesson: Map<string, Lesson>;
  deck: Map<string, DeckRef>;
}

export function slideHeading(slide: Slide): string {
  const def = getKind(slide.kind);
  const heading = def ? def.heading(slide.content) : '';
  return heading?.trim() || def?.label || 'Slide';
}

export async function loadNoteRefs(): Promise<NoteRefs> {
  const [courses, lessons, decks] = await Promise.all([db.courses.toArray(), db.lessons.toArray(), db.decks.toArray()]);
  const deckRefs: DeckRef[] = decks
    .map((d) => ({
      id: d.id,
      title: d.title || 'Untitled deck',
      lessonId: d.lessonId,
      purpose: deckPurpose(d),
      slides: d.slides.map((s, i) => ({ id: s.id, number: i + 1, heading: slideHeading(s), hidden: s.hidden })),
      updatedAt: d.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  courses.sort((a, b) => a.title.localeCompare(b.title));
  return {
    courses,
    lessons,
    decks: deckRefs,
    course: new Map(courses.map((c) => [c.id, c])),
    lesson: new Map(lessons.map((l) => [l.id, l])),
    deck: new Map(deckRefs.map((d) => [d.id, d])),
  };
}

export function useNoteRefs(): NoteRefs | undefined {
  return useLiveQuery(loadNoteRefs, []);
}

/** The CSS variable that colours a course. */
export function courseStyle(course?: Pick<Course, 'color'>): React.CSSProperties | undefined {
  return course ? ({ '--course': `var(--c-${course.color})` } as React.CSSProperties) : undefined;
}

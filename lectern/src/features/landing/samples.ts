// Sample content for the front page. Everything shown is drawn by the real slide
// engine from the same sample decks a first-time visitor finds in the app.

import { type Audience, type Deck, type KeyNotes, type Slide, emptyNotes } from '../../core/deck/types';
import { THEMES, type Theme } from '../../core/engine/themes';
import { allKinds } from '../../core/kinds/registry';
import type { AnyKind } from '../../core/kinds/types';
import type { Course, Lesson } from '../../data/db';
import { buildSeed } from '../../data/seed';
import { mix, readableOn } from '../looks/color';

export type SampleDeck = Pick<Deck, 'themeId' | 'audience' | 'title'>;

export interface Sample {
  slide: Slide;
  deck: SampleDeck;
  number: number;
  count: number;
}

let seed: ReturnType<typeof buildSeed> | null = null;

/** The app's first-launch sample data, built once and only read. */
export function sampleData() {
  seed ??= buildSeed(new Date());
  return seed;
}

/** A slide from the sample decks, with the deck it belongs to. */
export function sample(slideId: string): Sample | null {
  for (const deck of sampleData().decks) {
    const visible = deck.slides.filter((s) => !s.hidden);
    const i = visible.findIndex((s) => s.id === slideId);
    if (i >= 0) return { slide: visible[i], deck, number: i + 1, count: visible.length };
  }
  return null;
}

function made(slide: Slide, deck: SampleDeck, number = 2, count = 12): Sample {
  return { slide, deck, number, count };
}

function notes(partial: Partial<KeyNotes>): KeyNotes {
  return emptyNotes(partial);
}

// ─── Hero ─────────────────────────────────────────────────────────────

const PITCH_DECK: SampleDeck = { title: 'Fieldkit seed round', themeId: 'campus', audience: 'adult' };

const pitchSlide: Slide = {
  id: 'lp_pitch',
  kind: 'stats',
  content: {
    title: 'Six months of traction',
    stats: [
      { value: '1,240', label: 'Teams onboarded', detail: 'From a waitlist of 3,000' },
      { value: '38%', label: 'Monthly growth', detail: 'Since the March launch' },
      { value: '96%', label: 'Active at 90 days', detail: 'Across paid plans' },
    ],
  },
  notes: notes({
    script: 'Six months in, twelve hundred teams use Fieldkit every week. We grow thirty-eight percent a month, and almost nobody leaves.',
    cues: ['Pause after the growth number', 'Point to the retention figure'],
    minutes: 2,
  }),
};

export interface HeroSlide extends Sample {
  key: string;
  purpose: string;
  look: string;
}

export function heroSlides(): HeroSlide[] {
  const picks: { key: string; purpose: string; id?: string; custom?: Sample }[] = [
    { key: 'report', purpose: 'Report', id: 's_q3_03' },
    { key: 'pitch', purpose: 'Pitch', custom: made(pitchSlide, PITCH_DECK, 4, 11) },
    { key: 'talk', purpose: 'Talk', id: 's_mt_02' },
    { key: 'lesson', purpose: 'Lesson', id: 's_wc_07' },
    { key: 'kids', purpose: 'Young learners', id: 's_ah_03' },
  ];
  return picks.flatMap((p) => {
    const s = p.custom ?? (p.id ? sample(p.id) : null);
    if (!s) return [];
    const look = THEMES.find((t) => t.id === s.deck.themeId)?.name ?? 'Custom';
    return [{ ...s, key: p.key, purpose: p.purpose, look }];
  });
}

// ─── Slide types ──────────────────────────────────────────────────────

const GALLERY_DECK: SampleDeck = { title: 'Our field trip', themeId: 'sunny', audience: 'young' };

const gallerySlide: Slide = {
  id: 'lp_gallery',
  kind: 'gallery',
  content: {
    title: 'Our field trip',
    images: [
      { image: '/samples/nest.svg', caption: 'A nest in the hedge' },
      { image: '/samples/burrow.svg', caption: 'A rabbit burrow' },
      { image: '/samples/water-cycle.svg', caption: 'The pond loop' },
    ],
  },
  notes: notes({ minutes: 1 }),
};

/** One finished sample slide per built-in slide type, spread across the six looks. */
const KIND_SAMPLES: Record<string, string> = {
  title: 's_wv_01',
  section: 's_mt_05',
  agenda: 's_wc_02',
  bullets: 's_wv_07',
  compare: 's_ah_06',
  image: 's_wc_07',
  quote: 's_wv_09',
  term: 's_wc_05',
  stats: 's_q3_02',
  steps: 's_mt_07',
  question: 's_ah_02',
  recall: 's_wc_12',
  summary: 's_mt_13',
  closing: 's_ah_10',
  chart: 's_q3_07',
  table: 's_mt_09',
  timeline: 's_q3_06',
  statement: 's_q3_08',
  people: 's_mt_11',
  diagram: 's_mt_06',
  code: 's_q3_10',
};

export interface KindSample extends Sample {
  def: AnyKind;
}

/** Every slide type in this build (mods excluded), each drawn with a real sample. */
export function kindSamples(): KindSample[] {
  return allKinds()
    .filter((def) => !def.plugin)
    .map((def) => {
      if (def.kind === 'gallery') return { ...made(gallerySlide, GALLERY_DECK, 3, 8), def };
      const id = KIND_SAMPLES[def.kind];
      const found = id ? sample(id) : null;
      const s = found ?? made({ id: `lp_${def.kind}`, kind: def.kind, content: def.create(), notes: notes({}) }, { title: def.label, themeId: 'paper', audience: 'adult' });
      return { ...s, def };
    });
}

// ─── Brand looks ──────────────────────────────────────────────────────

export const BRAND_COLORS = [
  { id: 'ocean', label: 'Ocean', hex: '#1D5FD1' },
  { id: 'forest', label: 'Forest', hex: '#1F7A55' },
  { id: 'violet', label: 'Violet', hex: '#6A46DB' },
  { id: 'ember', label: 'Ember', hex: '#D4492A' },
  { id: 'graphite', label: 'Graphite', hex: '#232A33' },
] as const;

export const BRAND_TYPES = [
  { id: 'editorial', label: 'Editorial', detail: 'Serif headings', base: 'paper', decoration: 'corner' },
  { id: 'modern', label: 'Modern', detail: 'Bold sans', base: 'campus', decoration: 'band' },
  { id: 'friendly', label: 'Friendly', detail: 'Rounded', base: 'sunny', decoration: 'blobs' },
] as const;

export type BrandColor = (typeof BRAND_COLORS)[number]['id'];
export type BrandType = (typeof BRAND_TYPES)[number]['id'];

export interface BrandChoice {
  color: BrandColor;
  type: BrandType;
  logo: boolean;
  footer: string;
  audience: Audience;
}

function logoUrl(accent: string, ink: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">`
    + `<circle cx="48" cy="50" r="34" fill="${accent}"/>`
    + `<path d="M48 24c13 14 15 31 0 50c-15-19-13-36 0-50z" fill="${readableOn(accent)}"/>`
    + `<text x="96" y="66" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="46" font-weight="700" letter-spacing="-1" fill="${ink}">Juniper</text>`
    + `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A custom look built from the playground's choices. Each combination gets its own id, so layouts redraw. */
export function brandTheme(choice: BrandChoice): Theme {
  const accent = BRAND_COLORS.find((c) => c.id === choice.color)?.hex ?? BRAND_COLORS[0].hex;
  const type = BRAND_TYPES.find((t) => t.id === choice.type) ?? BRAND_TYPES[0];
  const base = THEMES.find((t) => t.id === type.base) ?? THEMES[0];
  const onAccent = readableOn(accent);
  return {
    ...base,
    id: `landing-brand:${choice.color}:${type.id}:${choice.logo ? 1 : 0}:${choice.footer}`,
    name: 'Juniper Labs',
    description: '',
    colors: {
      ...base.colors,
      bg: mix('#FFFFFF', accent, type.id === 'friendly' ? 0.07 : 0.035),
      surface: '#FFFFFF',
      accent,
      onAccent,
      accent2: mix(accent, '#FFFFFF', 0.8),
      line: mix(base.colors.line, accent, 0.12),
      sectionBg: accent,
      sectionInk: onAccent,
    },
    decoration: type.decoration,
    logo: choice.logo ? logoUrl(accent, base.colors.ink) : undefined,
    logoAspect: 3,
    logoPosition: 'top-right',
    footerText: choice.footer,
  };
}

export const BRAND_SLIDES: Slide[] = [
  {
    id: 'lp_brand_title',
    kind: 'title',
    variant: 'left',
    content: {
      eyebrow: 'Board update · Q1 2027',
      title: 'Water where it counts',
      subtitle: 'Smart irrigation for small farms',
      presenter: 'Dana Wells · CEO',
      image: '',
    },
    notes: notes({ minutes: 1 }),
  },
  {
    id: 'lp_brand_chart',
    kind: 'chart',
    variant: 'column',
    content: {
      title: 'Farms using Juniper',
      rows: [
        { label: "Q2 '26", value: '120', value2: '' },
        { label: "Q3 '26", value: '210', value2: '' },
        { label: "Q4 '26", value: '340', value2: '' },
        { label: "Q1 '27", value: '520', value2: '' },
      ],
      series: 'Farms', series2: '', unit: '', unitBefore: false,
      takeaway: 'Four times as many farms in a year.',
      values: true, legend: false, reveal: false,
    },
    notes: notes({ minutes: 2 }),
  },
];

// ─── Classroom ────────────────────────────────────────────────────────

export interface CourseSample {
  course: Course;
  weeks: { week: number; title: string; lessons: Lesson[] }[];
}

export function courseSample(courseId = 'course_earth'): CourseSample | null {
  const { courses, lessons } = sampleData();
  const course = courses.find((c) => c.id === courseId);
  if (!course) return null;
  const own = lessons.filter((l) => l.courseId === course.id).sort((a, b) => a.week - b.week || a.order - b.order);
  const weekNumbers = [...new Set(own.map((l) => l.week))];
  return {
    course,
    weeks: weekNumbers.map((week) => ({ week, title: course.weekTitles?.[week] ?? '', lessons: own.filter((l) => l.week === week) })),
  };
}

/** Local-time ISO date, YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday to Friday of this week, with the sample lessons on each day. */
export function weekSample(today = new Date()) {
  const { courses, lessons } = sampleData();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 5 }, (_, i) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const iso = isoDay(day);
    const items = lessons
      .filter((l) => l.date === iso)
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
      .map((lesson) => ({ lesson, course: courses.find((c) => c.id === lesson.courseId) }));
    return { iso, day, items };
  });
}

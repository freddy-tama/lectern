// Sample content for the front page. Everything shown is drawn by the real slide
// engine from the same sample decks a first-time visitor finds in the app.

import { type Audience, type Deck, type KeyNotes, type Slide, deckMinutes as exactMinutes, emptyNotes } from '../../core/deck/types';
import { layoutSlide } from '../../core/engine/layout';
import { THEMES, type Theme, getTheme } from '../../core/engine/themes';
import { allKinds, getKind } from '../../core/kinds/registry';
import type { AnyKind, KindGroup } from '../../core/kinds/types';
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

/** The sample talk the page is built around. */
export const TALK_ID = 'deck_meetings_talk';

/** A sample deck by id. */
export function sampleDeck(id: string): Deck | null {
  return sampleData().decks.find((d) => d.id === id) ?? null;
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

/** A deck's visible slides with their click counts, worked out as present mode does. */
export function deckRun(deck: Deck): { slides: Slide[]; steps: number[] } {
  const slides = deck.slides.filter((s) => !s.hidden);
  const theme = getTheme(deck.themeId);
  const steps = slides.map((s, i) => layoutSlide(s, { theme, audience: deck.audience, slideNumber: i + 1, slideCount: slides.length }).steps);
  return { slides, steps };
}

/** The total speaking time of a deck's visible slides, in whole minutes. */
export function deckMinutes(deck: Pick<Deck, 'slides'>): number {
  return Math.round(exactMinutes(deck));
}

/** One line naming a slide. */
export function slideHeading(slide: Slide): string {
  return getKind(slide.kind)?.heading(slide.content) ?? '';
}

/** Where the quiz link and the QR slide point: the public site when one is set, else this one. */
export function qrOrigin(): string {
  return import.meta.env.VITE_PUBLIC_ORIGIN || (typeof location === 'undefined' ? '' : location.origin);
}

function made(slide: Slide, deck: SampleDeck, number = 2, count = 12): Sample {
  return { slide, deck, number, count };
}

function notes(partial: Partial<KeyNotes>): KeyNotes {
  return emptyNotes(partial);
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

/**
 * Kinds whose still frame would be blank or a placeholder, so the page names them
 * instead of drawing them. Credits is one while no sample slide has credits to list.
 */
const TEXT_TILES: Record<string, string> = {
  video: 'Plays when you present.',
  web: 'Plays when you present.',
  activity: 'Plays when you present.',
  credits: 'Lists where your pictures came from.',
};

/** Answers a room might give, so the word cloud sample shows a cloud. */
const SAMPLE_CLOUD = ([
  ['Agenda', 9], ['Short', 7], ['Decisions', 6], ['Clear goal', 5], ['On time', 4], ['Focus', 4], ['Actions', 3], ['Coffee', 3],
  ['No laptops', 3], ['Prepared', 2], ['Listening', 2], ['Fewer people', 2], ['Notes', 2], ['Outcome', 1], ['Energy', 1], ['Humour', 1],
] as const).map(([text, count]) => ({ text, count: String(count) }));

/** The order of the Add slide menu. */
export const KIND_GROUPS: KindGroup[] = ['Open', 'Explain', 'Data', 'Visual', 'Media', 'Engage', 'Close'];

export interface KindSample extends Sample {
  def: AnyKind;
  /** Set for a kind shown as words instead of a slide. */
  tile?: string;
}

/** Every slide type in this build, mods excluded. */
export function coreKinds(): AnyKind[] {
  return allKinds().filter((def) => !def.plugin);
}

function created(def: AnyKind, content: Record<string, unknown>, themeId = 'paper'): Sample {
  return made({ id: `lp_${def.kind}`, kind: def.kind, content, notes: notes({}) }, { title: def.label, themeId, audience: 'adult' });
}

/** A sample slide that lists picture credits, if any sample deck has one. */
function creditsSample(): Sample | null {
  for (const deck of sampleData().decks) {
    const own = deck.slides.find((s) => s.kind === 'credits' && !s.hidden && Array.isArray(s.content.lines) && s.content.lines.length > 0);
    if (own) return sample(own.id);
  }
  return null;
}

/** Every slide type in this build (mods excluded), each drawn with a real sample or named in words. */
export function kindSamples(): KindSample[] {
  return coreKinds().map((def) => {
    if (def.kind === 'credits') {
      const own = creditsSample();
      return own ? { ...own, def } : { ...created(def, def.create()), def, tile: TEXT_TILES.credits };
    }
    if (def.kind === 'gallery') return { ...made(gallerySlide, GALLERY_DECK, 3, 8), def };
    if (def.kind === 'qr') return { ...created(def, { ...def.create(), url: `${qrOrigin()}/welcome` }), def };
    if (def.kind === 'cards') return { ...created(def, def.create(), 'minimal'), def };
    if (def.kind === 'contact') return { ...created(def, { ...def.create(), link: `${qrOrigin()}/welcome` }), def };
    if (def.kind === 'wordcloud') return { ...created(def, { ...def.create(), answers: SAMPLE_CLOUD }), def };
    if (def.kind === 'screenshot') return { ...created(def, { ...def.create(), image: '/samples/app-screen.svg' }), def };
    const id = KIND_SAMPLES[def.kind];
    const found = id ? sample(id) : null;
    return { ...(found ?? created(def, def.create())), def, tile: TEXT_TILES[def.kind] };
  });
}

/** The two slide types that run on the slide itself, set up to try here. */
export function liveSamples(): { timer: Sample | null; picker: Sample | null } {
  const timer = getKind('timer');
  const picker = getKind('picker');
  return {
    timer: timer ? created(timer, { ...timer.create(), title: 'Talk it over', minutes: '2:00' }, 'minimal') : null,
    picker: picker ? created(picker, { ...picker.create(), items: ['Maya', 'Tom', 'Priya', 'Sam', 'Lee', 'Ana'] }, 'minimal') : null,
  };
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

// ─── Course ────────────────────────────────────────────────────────

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

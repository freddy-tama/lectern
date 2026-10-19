// Slide themes. A theme is colours, two typefaces and a decoration recipe.
// Web fonts are used on screen; the PowerPoint names are what the exported file asks for.

export type Decoration = 'none' | 'corner' | 'band' | 'dots' | 'grid' | 'blobs';

export const DECORATIONS: { id: Decoration; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'corner', label: 'Corner' },
  { id: 'band', label: 'Band' },
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Glow' },
  { id: 'blobs', label: 'Blobs' },
];

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface ThemeFonts {
  web: string;
  pptx: string;
  weight: number;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: {
    bg: string;
    /** Cards and panels on the background. */
    surface: string;
    ink: string;
    muted: string;
    accent: string;
    /** Text drawn on the accent colour. */
    onAccent: string;
    /** A second, quieter accent for supporting shapes. */
    accent2: string;
    line: string;
    /** Background of section dividers. */
    sectionBg: string;
    sectionInk: string;
    /** Correct-answer highlight. */
    good: string;
  };
  display: ThemeFonts;
  body: ThemeFonts;
  mono: ThemeFonts;
  decoration: Decoration;
  /** Corner radius for cards, in canvas px. */
  radius: number;
  /** Multiplier on all type sizes; rounded friendly faces read smaller. */
  sizeBias: number;
  titleCase?: 'none' | 'upper';
  /** Made by the user in the look editor and saved in this browser. */
  custom?: boolean;
  /** The built-in look a custom look started from. */
  baseId?: string;
  /** Image source for a logo ("asset:<id>", a data: URL or an http(s) URL). */
  logo?: string;
  /** Logo width divided by height, so the box hugs the image. */
  logoAspect?: number;
  logoPosition?: LogoPosition;
  /** A short line shown at the foot of content slides. */
  footerText?: string;
}

export const MONO: ThemeFonts = { web: '"JetBrains Mono", "Cascadia Code", Consolas, monospace', pptx: 'Consolas', weight: 500 };
export const INTER = '"Inter Variable", Inter, "Segoe UI", system-ui, sans-serif';
export const FRAUNCES = '"Fraunces Variable", Fraunces, Georgia, serif';
export const NUNITO = '"Nunito Variable", Nunito, "Segoe UI", system-ui, sans-serif';

export const THEMES: Theme[] = [
  {
    id: 'paper',
    name: 'Paper',
    description: 'Warm, editorial and calm. Works for any subject.',
    colors: {
      bg: '#F7F3EC', surface: '#FFFFFF', ink: '#1E1C19', muted: '#6B655B', accent: '#D9502B', onAccent: '#FFFFFF',
      accent2: '#E9DFCF', line: '#E2D9CA', sectionBg: '#1E1C19', sectionInk: '#F7F3EC', good: '#2F7D4F',
    },
    display: { web: FRAUNCES, pptx: 'Georgia', weight: 600 },
    body: { web: INTER, pptx: 'Segoe UI', weight: 420 },
    mono: MONO,
    decoration: 'corner',
    radius: 28,
    sizeBias: 1,
  },
  {
    id: 'chalk',
    name: 'Chalkboard',
    description: 'High contrast on deep green. Good in bright rooms.',
    colors: {
      bg: '#1F3A33', surface: '#274740', ink: '#F4F1E8', muted: '#B9C6BF', accent: '#F2C14E', onAccent: '#1F3A33',
      accent2: '#2E544B', line: '#3B6157', sectionBg: '#F2C14E', sectionInk: '#1F3A33', good: '#8FD6A5',
    },
    display: { web: INTER, pptx: 'Segoe UI Semibold', weight: 700 },
    body: { web: INTER, pptx: 'Segoe UI', weight: 420 },
    mono: MONO,
    decoration: 'dots',
    radius: 20,
    sizeBias: 1,
  },
  {
    id: 'campus',
    name: 'Campus',
    description: 'Bright and clear, with a confident blue.',
    colors: {
      bg: '#FFFFFF', surface: '#F1F5FB', ink: '#14213D', muted: '#56627A', accent: '#2155D6', onAccent: '#FFFFFF',
      accent2: '#FFD25C', line: '#D9E2F0', sectionBg: '#2155D6', sectionInk: '#FFFFFF', good: '#1D8A55',
    },
    display: { web: INTER, pptx: 'Segoe UI Black', weight: 800 },
    body: { web: INTER, pptx: 'Segoe UI', weight: 420 },
    mono: MONO,
    decoration: 'band',
    radius: 24,
    sizeBias: 1,
  },
  {
    id: 'sunny',
    name: 'Sunny',
    description: 'Rounded, cheerful and roomy. Made for young learners.',
    colors: {
      bg: '#FFF8E7', surface: '#FFFFFF', ink: '#2B2340', muted: '#6E6487', accent: '#FF6B4A', onAccent: '#FFFFFF',
      accent2: '#8ED1C6', line: '#F3E3BE', sectionBg: '#8ED1C6', sectionInk: '#2B2340', good: '#2E9A63',
    },
    display: { web: NUNITO, pptx: 'Arial Rounded MT Bold', weight: 800 },
    body: { web: NUNITO, pptx: 'Segoe UI', weight: 600 },
    mono: MONO,
    decoration: 'blobs',
    radius: 40,
    sizeBias: 1.06,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark and focused. Suits technical talks and evening classes.',
    colors: {
      bg: '#0F1420', surface: '#182033', ink: '#EEF2FA', muted: '#9AA6BD', accent: '#5BD1C2', onAccent: '#0F1420',
      accent2: '#24304A', line: '#283552', sectionBg: '#5BD1C2', sectionInk: '#0F1420', good: '#7BE0A0',
    },
    display: { web: INTER, pptx: 'Segoe UI Semibold', weight: 650 },
    body: { web: INTER, pptx: 'Segoe UI', weight: 400 },
    mono: MONO,
    decoration: 'grid',
    radius: 18,
    sizeBias: 1,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'White space and one colour. Lets the content speak.',
    colors: {
      bg: '#FFFFFF', surface: '#F5F5F4', ink: '#111111', muted: '#6B6B6B', accent: '#111111', onAccent: '#FFFFFF',
      accent2: '#ECECEA', line: '#E4E4E2', sectionBg: '#111111', sectionInk: '#FFFFFF', good: '#1E7A46',
    },
    display: { web: INTER, pptx: 'Segoe UI Semibold', weight: 650 },
    body: { web: INTER, pptx: 'Segoe UI', weight: 400 },
    mono: MONO,
    decoration: 'none',
    radius: 12,
    sizeBias: 1,
  },
];

const extraThemes: Theme[] = [];
let preview: Theme | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function changed() {
  revision++;
  listeners.forEach((fn) => fn());
}

export function isBuiltInTheme(id: string) {
  return THEMES.some((t) => t.id === id);
}

/**
 * Adds a look. A custom look with an id already registered replaces it;
 * the built-in looks can never be replaced.
 */
export function registerTheme(theme: Theme) {
  if (isBuiltInTheme(theme.id)) return;
  const i = extraThemes.findIndex((t) => t.id === theme.id);
  if (i < 0) extraThemes.push(theme);
  else if (theme.custom || extraThemes[i].custom) extraThemes[i] = theme;
  else return;
  changed();
}

/** Removes a registered look. Decks that used it fall back to the default look. */
export function unregisterTheme(id: string) {
  const i = extraThemes.findIndex((t) => t.id === id);
  if (i < 0) return;
  extraThemes.splice(i, 1);
  changed();
}

/**
 * A look being edited, reachable through getTheme but not listed by allThemes.
 * Give each revision a new id so memoised layouts notice the change.
 */
export function setPreviewTheme(theme: Theme | null) {
  preview = theme;
}

export function allThemes(): Theme[] {
  return [...THEMES, ...extraThemes];
}

export function customThemes(): Theme[] {
  return extraThemes.filter((t) => t.custom);
}

export function getTheme(id: string | undefined): Theme {
  if (preview && id === preview.id) return preview;
  return allThemes().find((t) => t.id === id) ?? THEMES[0];
}

/** Changes whenever looks are added, replaced or removed. Pair with subscribeThemes in useSyncExternalStore. */
export function themesRevision() {
  return revision;
}

export function subscribeThemes(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Picks the font family string used for measuring and drawing. */
export function fontFamily(theme: Theme, role: 'display' | 'body' | 'mono', target: 'web' | 'pptx' = 'web'): string {
  const f = role === 'display' ? theme.display : role === 'mono' ? theme.mono : theme.body;
  return target === 'web' ? f.web : f.pptx;
}

export function fontWeight(theme: Theme, role: 'display' | 'body' | 'mono'): number {
  return (role === 'display' ? theme.display : role === 'mono' ? theme.mono : theme.body).weight;
}

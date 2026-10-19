// Curated choices for the look editor: typefaces that work on screen and in PowerPoint, and colour sets.

import { FRAUNCES, INTER, NUNITO, type Theme, THEMES } from '../../core/engine/themes';
import { contrast, isDark, mix, readableOn } from './color';

export interface FontChoice {
  id: string;
  label: string;
  /** CSS font-family used on screen. */
  web: string;
  /** The face PowerPoint asks for. */
  pptx: string;
  kind: 'Serif' | 'Sans serif' | 'Rounded';
}

export const FONT_CHOICES: FontChoice[] = [
  { id: 'inter', label: 'Inter', web: INTER, pptx: 'Segoe UI', kind: 'Sans serif' },
  { id: 'fraunces', label: 'Fraunces', web: FRAUNCES, pptx: 'Georgia', kind: 'Serif' },
  { id: 'nunito', label: 'Nunito', web: NUNITO, pptx: 'Segoe UI', kind: 'Rounded' },
  { id: 'georgia', label: 'Georgia', web: 'Georgia, "Times New Roman", serif', pptx: 'Georgia', kind: 'Serif' },
  { id: 'palatino', label: 'Palatino', web: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif', pptx: 'Palatino Linotype', kind: 'Serif' },
  { id: 'arial', label: 'Arial', web: 'Arial, Helvetica, sans-serif', pptx: 'Arial', kind: 'Sans serif' },
  { id: 'verdana', label: 'Verdana', web: 'Verdana, Geneva, sans-serif', pptx: 'Verdana', kind: 'Sans serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', web: '"Trebuchet MS", "Segoe UI", sans-serif', pptx: 'Trebuchet MS', kind: 'Sans serif' },
  { id: 'segoe', label: 'Segoe UI', web: '"Segoe UI", system-ui, sans-serif', pptx: 'Segoe UI', kind: 'Sans serif' },
  { id: 'calibri', label: 'Calibri', web: 'Calibri, Carlito, "Segoe UI", sans-serif', pptx: 'Calibri', kind: 'Sans serif' },
];

export const HEADING_WEIGHTS: { value: number; label: string }[] = [
  { value: 500, label: 'Regular' },
  { value: 650, label: 'Semibold' },
  { value: 800, label: 'Bold' },
];

/** Which curated font a theme's typeface matches, if any. */
export function fontChoiceOf(f: { web: string }): FontChoice | undefined {
  return FONT_CHOICES.find((c) => c.web === f.web);
}

export type EditableColor = 'bg' | 'surface' | 'ink' | 'muted' | 'accent' | 'accent2';

export const COLOR_FIELDS: { key: EditableColor; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Cards' },
  { key: 'ink', label: 'Text' },
  { key: 'muted', label: 'Quiet text' },
  { key: 'accent', label: 'Accent' },
  { key: 'accent2', label: 'Second accent' },
];

export interface Palette {
  id: string;
  name: string;
  colors: Record<EditableColor, string>;
}

export const PALETTES: Palette[] = [
  { id: 'ocean', name: 'Ocean', colors: { bg: '#F4F8FB', surface: '#FFFFFF', ink: '#0E2A3B', muted: '#4D6577', accent: '#0E7C9B', accent2: '#CFE6EE' } },
  { id: 'forest', name: 'Forest', colors: { bg: '#F3F5EF', surface: '#FFFFFF', ink: '#1D2B1F', muted: '#55635A', accent: '#2F7A4A', accent2: '#DCE7D3' } },
  { id: 'slate', name: 'Slate', colors: { bg: '#F5F6F8', surface: '#FFFFFF', ink: '#1B2230', muted: '#586273', accent: '#3E5BA9', accent2: '#DDE3EF' } },
  { id: 'sand', name: 'Sand', colors: { bg: '#FAF5EC', surface: '#FFFFFF', ink: '#2B2620', muted: '#6A6155', accent: '#B0592A', accent2: '#EEDFC8' } },
  { id: 'plum', name: 'Plum', colors: { bg: '#FBF7FB', surface: '#FFFFFF', ink: '#2A1630', muted: '#6A5670', accent: '#8A3FA0', accent2: '#EBDDF0' } },
  { id: 'signal', name: 'Signal', colors: { bg: '#FFFFFF', surface: '#F4F4F4', ink: '#0A0A0A', muted: '#5C5C5C', accent: '#D93A22', accent2: '#EDEDED' } },
  { id: 'navy', name: 'Navy and gold', colors: { bg: '#0F1B33', surface: '#172648', ink: '#F3F5FA', muted: '#A7B2C9', accent: '#F2B544', accent2: '#22355E' } },
  { id: 'ember', name: 'Ember', colors: { bg: '#1A1412', surface: '#261D1A', ink: '#F7EFE9', muted: '#BFAEA4', accent: '#FF7A45', accent2: '#3A2A24' } },
];

/** Fills in the colours the editor does not ask for, from the six it does. */
export function deriveColors(c: Record<EditableColor, string>, good?: string): Theme['colors'] {
  const dark = isDark(c.bg);
  const onAccent = readableOn(c.accent);
  const okGood = good && contrast(good, c.bg) >= 3 ? good : dark ? '#7BE0A0' : '#1E7A46';
  return {
    ...c,
    onAccent,
    line: mix(c.bg, c.ink, dark ? 0.16 : 0.11),
    sectionBg: c.accent,
    sectionInk: onAccent,
    good: okGood,
  };
}

export interface ContrastIssue {
  label: string;
  ratio: number;
  need: number;
}

/** Colour pairs on the slides that fall below WCAG contrast guidance. */
export function contrastIssues(theme: Theme): ContrastIssue[] {
  const c = theme.colors;
  const checks: ContrastIssue[] = [
    { label: 'Text on the background', ratio: contrast(c.ink, c.bg), need: 4.5 },
    { label: 'Text on cards', ratio: contrast(c.ink, c.surface), need: 4.5 },
    { label: 'Quiet text on the background', ratio: contrast(c.muted, c.bg), need: 4.5 },
    { label: 'Accent numbers and labels', ratio: contrast(c.accent, c.bg), need: 3 },
  ];
  return checks.filter((x) => x.ratio < x.need);
}

/** Applies a built-in look's styling to a draft, keeping its name, logo and footer. */
export function startFrom(draft: Theme, baseId: string): Theme {
  const base = THEMES.find((t) => t.id === baseId) ?? THEMES[0];
  return {
    ...draft,
    baseId: base.id,
    colors: { ...base.colors },
    display: { ...base.display },
    body: { ...base.body },
    mono: { ...base.mono },
    decoration: base.decoration,
    radius: base.radius,
    sizeBias: base.sizeBias,
    titleCase: base.titleCase,
  };
}

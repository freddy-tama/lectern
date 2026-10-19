// Custom looks, saved in this browser under one settings key and registered as themes.

import { uid } from '../core/deck/types';
import {
  DECORATIONS, type LogoPosition, type Theme, type ThemeFonts, THEMES, customThemes, getTheme, isBuiltInTheme, registerTheme, unregisterTheme,
} from '../core/engine/themes';
import { db } from './db';

const KEY = 'looks';
const POSITIONS: LogoPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export function newLookId() {
  return uid('look');
}

function str(v: unknown, fallback: string) {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

function fonts(v: unknown, fallback: ThemeFonts): ThemeFonts {
  const f = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const weight = Number(f.weight);
  return { web: str(f.web, fallback.web), pptx: str(f.pptx, fallback.pptx), weight: Number.isFinite(weight) ? Math.max(100, Math.min(900, weight)) : fallback.weight };
}

/** Reads a saved look defensively; anything missing comes from the look it started from. */
export function normalizeLook(value: unknown): Theme | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === 'string' ? v.id : '';
  if (!id || isBuiltInTheme(id)) return null;
  const base = THEMES.find((t) => t.id === v.baseId) ?? THEMES[0];
  const colors = (v.colors && typeof v.colors === 'object' ? v.colors : {}) as Record<string, unknown>;
  const radius = Number(v.radius);
  const sizeBias = Number(v.sizeBias);
  const aspect = Number(v.logoAspect);
  const logo = typeof v.logo === 'string' && v.logo.trim() ? v.logo : undefined;
  return {
    id,
    name: str(v.name, 'My look'),
    description: typeof v.description === 'string' ? v.description : 'Your own look.',
    colors: Object.fromEntries(Object.entries(base.colors).map(([k, d]) => [k, str(colors[k], d)])) as Theme['colors'],
    display: fonts(v.display, base.display),
    body: fonts(v.body, base.body),
    mono: fonts(v.mono, base.mono),
    decoration: DECORATIONS.some((d) => d.id === v.decoration) ? v.decoration as Theme['decoration'] : base.decoration,
    radius: Number.isFinite(radius) ? Math.max(0, Math.min(64, radius)) : base.radius,
    sizeBias: Number.isFinite(sizeBias) && sizeBias > 0.8 && sizeBias < 1.2 ? sizeBias : base.sizeBias,
    titleCase: v.titleCase === 'upper' ? 'upper' : base.titleCase,
    custom: true,
    baseId: base.id,
    logo,
    logoAspect: logo && Number.isFinite(aspect) && aspect > 0 ? aspect : undefined,
    logoPosition: POSITIONS.includes(v.logoPosition as LogoPosition) ? v.logoPosition as LogoPosition : 'top-right',
    footerText: typeof v.footerText === 'string' ? v.footerText.slice(0, 120) : '',
  };
}

async function readStored(): Promise<Theme[]> {
  const row = await db.settings.get(KEY);
  const list = Array.isArray(row?.value) ? row.value : [];
  return list.map(normalizeLook).filter((t): t is Theme => Boolean(t));
}

/** Loads saved looks and registers them. Call before the first render so decks draw in their look. */
export async function loadLooks(): Promise<Theme[]> {
  const looks = await readStored();
  looks.forEach(registerTheme);
  return looks;
}

/** Saves a new or edited look and registers it. */
export async function saveLook(theme: Theme): Promise<Theme> {
  const look = normalizeLook({ ...theme, custom: true });
  if (!look) throw new Error('A look needs its own id.');
  const looks = await readStored();
  const i = looks.findIndex((t) => t.id === look.id);
  if (i < 0) looks.push(look);
  else looks[i] = look;
  await db.settings.put({ key: KEY, value: looks });
  registerTheme(look);
  return look;
}

export async function deleteLook(id: string): Promise<void> {
  const looks = await readStored();
  await db.settings.put({ key: KEY, value: looks.filter((t) => t.id !== id) });
  unregisterTheme(id);
}

/** The user's looks as currently registered, in the order they were made. */
export function savedLooks(): Theme[] {
  return customThemes();
}

/** A copy of a look with a new id, ready for the editor. */
export function copyLook(source: Theme, name?: string): Theme {
  const base = source.custom ? source.baseId ?? THEMES[0].id : source.id;
  return {
    ...source,
    colors: { ...source.colors },
    display: { ...source.display },
    body: { ...source.body },
    mono: { ...source.mono },
    id: newLookId(),
    name: name ?? `${source.name} copy`,
    description: 'Your own look.',
    custom: true,
    baseId: getTheme(base).id,
    logoPosition: source.logoPosition ?? 'top-right',
    footerText: source.footerText ?? '',
  };
}

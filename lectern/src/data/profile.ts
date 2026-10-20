// What a person told Lectern about themselves: what they came to do, who they present to,
// how they like slides, and the answers they asked Lectern to remember. It adapts the home
// page, the sidebar and the defaults of every new deck. Kept in localStorage so the first
// paint can read it synchronously, like the theme preference.

import { useSyncExternalStore } from 'react';
import { AUDIENCES, type Audience, type DeckPurpose, PURPOSES } from '../core/deck/types';

/** The main reason someone uses Lectern. It decides what the home page leads with. */
export type Focus = 'deck' | 'present' | 'teach' | 'study' | 'all';

/** How much goes on a slide. Younger audiences get fewer words and more pictures. */
export type Density = 'visual' | 'balanced' | 'detailed';

/** Parts of the app that can be hidden from the sidebar. Decks and Home always show. */
export type Feature = 'courses' | 'schedule' | 'notes' | 'recordings';

export const FEATURES: Feature[] = ['courses', 'schedule', 'notes', 'recordings'];

export const FOCUSES: Focus[] = ['deck', 'present', 'teach', 'study', 'all'];

export const DENSITIES: { id: Density; label: string; detail: string }[] = [
  { id: 'visual', label: 'Mostly pictures', detail: 'A few big words per slide' },
  { id: 'balanced', label: 'Balanced', detail: 'Short points with visuals' },
  { id: 'detailed', label: 'Detailed', detail: 'Fuller points, tables and charts' },
];

export const LENGTHS = [5, 10, 15, 20, 30, 45, 60, 90];

export interface DeckPrefs {
  purpose: DeckPurpose;
  audience: Audience;
  themeId: string;
  minutes: number;
  density: Density;
}

/** An answer to one of the AI's questions that the person asked Lectern to keep. */
export interface RememberedAnswer {
  /** Short stable id from the AI, for example "tone". A newer answer with the same key replaces the old one. */
  key: string;
  question: string;
  answer: string;
  updatedAt: number;
}

export interface Profile {
  version: 1;
  /** True once the questionnaire was finished or skipped. */
  onboarded: boolean;
  /** When the questionnaire was finished. Missing when it was skipped. */
  completedAt?: number;
  focus: Focus;
  /** Parts of the app shown in the sidebar. */
  features: Feature[];
  deck: DeckPrefs;
  /** Let the AI ask a few questions before it drafts a deck. */
  askQuestions: boolean;
  remembered: RememberedAnswer[];
}

const KEY = 'lectern.profile';
const MAX_REMEMBERED = 16;

/** What each focus starts with. The questionnaire preselects these; people can change any of them. */
export const FOCUS_DEFAULTS: Record<Focus, { purpose: DeckPurpose; audience: Audience; minutes: number; features: Feature[] }> = {
  deck: { purpose: 'talk', audience: 'adult', minutes: 15, features: [] },
  present: { purpose: 'talk', audience: 'adult', minutes: 20, features: ['schedule', 'notes'] },
  teach: { purpose: 'lesson', audience: 'teen', minutes: 45, features: ['courses', 'schedule', 'notes', 'recordings'] },
  study: { purpose: 'lesson', audience: 'adult', minutes: 30, features: ['courses', 'notes', 'recordings', 'schedule'] },
  all: { purpose: 'talk', audience: 'adult', minutes: 30, features: ['courses', 'schedule', 'notes', 'recordings'] },
};

/** The density that suits an audience. Young learners get mostly pictures. */
export function densityFor(audience: Audience): Density {
  return audience === 'young' ? 'visual' : 'balanced';
}

export function defaultProfile(): Profile {
  return {
    version: 1,
    onboarded: false,
    focus: 'all',
    features: [...FOCUS_DEFAULTS.all.features],
    deck: { purpose: 'talk', audience: 'adult', themeId: 'paper', minutes: 30, density: 'balanced' },
    askQuestions: true,
    remembered: [],
  };
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** Reads anything that claims to be a profile (an old save, a hand-edited value) into a valid one. */
export function normalizeProfile(raw: unknown): Profile {
  const base = defaultProfile();
  if (!raw || typeof raw !== 'object') return base;
  const v = raw as Record<string, unknown>;
  const deck = (v.deck && typeof v.deck === 'object' ? v.deck : {}) as Record<string, unknown>;
  const minutes = Number(deck.minutes);
  const remembered = Array.isArray(v.remembered)
    ? (v.remembered as Record<string, unknown>[])
        .filter((r) => r && typeof r.key === 'string' && typeof r.answer === 'string' && r.answer.trim())
        .map((r) => ({
          key: String(r.key).slice(0, 40),
          question: String(r.question ?? '').slice(0, 300),
          answer: String(r.answer).slice(0, 300),
          updatedAt: Number(r.updatedAt) || 0,
        }))
        .slice(0, MAX_REMEMBERED)
    : [];
  return {
    version: 1,
    onboarded: Boolean(v.onboarded),
    ...(Number(v.completedAt) > 0 ? { completedAt: Number(v.completedAt) } : {}),
    focus: oneOf(v.focus, FOCUSES, base.focus),
    features: Array.isArray(v.features) ? FEATURES.filter((f) => (v.features as unknown[]).includes(f)) : base.features,
    deck: {
      purpose: oneOf(deck.purpose, PURPOSES.map((p) => p.id), base.deck.purpose),
      audience: oneOf(deck.audience, AUDIENCES.map((a) => a.id), base.deck.audience),
      themeId: typeof deck.themeId === 'string' && deck.themeId ? deck.themeId.slice(0, 80) : base.deck.themeId,
      minutes: Number.isFinite(minutes) && minutes >= 5 && minutes <= 180 ? Math.round(minutes) : base.deck.minutes,
      density: oneOf(deck.density, DENSITIES.map((d) => d.id), base.deck.density),
    },
    askQuestions: v.askQuestions === undefined ? true : Boolean(v.askQuestions),
    remembered,
  };
}

/** Adds or replaces remembered answers by key, newest first, keeping the list short. */
export function mergeRemembered(list: RememberedAnswer[], add: RememberedAnswer[]): RememberedAnswer[] {
  const fresh = add.filter((a) => a.key && a.answer.trim());
  const keys = new Set(fresh.map((a) => a.key));
  return [...fresh, ...list.filter((r) => !keys.has(r.key))].slice(0, MAX_REMEMBERED);
}

// ─── Store ────────────────────────────────────────────────────────────

let cached: Profile | null = null;
const listeners = new Set<() => void>();

function read(): Profile {
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return defaultProfile();
  }
}

export function getProfile(): Profile {
  cached ??= read();
  return cached;
}

export function saveProfile(next: Profile) {
  cached = normalizeProfile(next);
  try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* private mode: kept for this visit */ }
  listeners.forEach((l) => l());
}

export function updateProfile(patch: Partial<Profile> | ((p: Profile) => Partial<Profile>)) {
  const current = getProfile();
  saveProfile({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) });
}

/** Remembers the settings of the deck just made, so the next one starts the same way. */
export function rememberDeckPrefs(prefs: Partial<DeckPrefs>, answers: RememberedAnswer[] = []) {
  updateProfile((p) => ({ deck: { ...p.deck, ...prefs }, remembered: mergeRemembered(p.remembered, answers) }));
}

export function forgetAnswer(key: string) {
  updateProfile((p) => ({ remembered: p.remembered.filter((r) => r.key !== key) }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cached = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useProfile(): Profile {
  return useSyncExternalStore(subscribe, getProfile, getProfile);
}

/** Whether a part of the app shows in the sidebar for this person. */
export function shows(profile: Profile, feature: Feature): boolean {
  return profile.features.includes(feature);
}

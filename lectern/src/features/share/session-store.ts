// What a sharing session keeps in this browser, so a reload of the presenter's page doesn't
// end it: the same code and QR code keep working, and scores and answers are still there.
// Plain localStorage, since a page that is closing can't wait for a database.

import { type LiveState, accessQuery } from '../../core/share/protocol';
import type { QuizDump, QuizStage } from '../../core/share/quiz';

export interface SavedSession {
  code: string;
  token: string;
  deckId: string;
  title: string;
  /** When the session was last alive. */
  at: number;
  state: LiveState | null;
  stage: QuizStage;
  onScreen: boolean;
  quiz: QuizDump;
  /** slide → player → choice */
  votes: [string, [string, number][]][];
  /** slide → player → words */
  words: [string, [string, string[]][]][];
  /** slide → word keys the presenter took off the cloud */
  hidden: [string, string[]][];
}

const PREFIX = 'lectern.share.session.';
/** A session nobody touched for this long is over. */
export const SESSION_MAX = 3 * 60 * 60_000;

export function saveSession(session: SavedSession) {
  try { localStorage.setItem(PREFIX + session.code, JSON.stringify(session)); } catch { /* private mode, or storage is full */ }
}

export function clearSession(code: string) {
  try { localStorage.removeItem(PREFIX + code); } catch { /* private mode */ }
}

/** Sessions that can still be picked up, newest first. Old ones are thrown away. */
export function savedSessions(now = Date.now()): SavedSession[] {
  const out: SavedSession[] = [];
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      let session: SavedSession | null = null;
      try { session = JSON.parse(localStorage.getItem(key) ?? 'null') as SavedSession | null; } catch { /* damaged */ }
      if (session?.code && session.token && session.deckId && now - session.at < SESSION_MAX) out.push(session);
      else localStorage.removeItem(key);
    }
  } catch { /* private mode */ }
  return out.sort((a, b) => b.at - a.at);
}

/** Where the show was, so a reloaded presenter window comes back to the same slide. */
export function savedShow(deckId: string): LiveState | null {
  return savedSessions().find((s) => s.deckId === deckId)?.state ?? null;
}

let release: (() => void) | null = null;

/**
 * Holds a session for this tab. False when another tab of this browser already has it.
 * Browsers without locks (or pages not on https) answer true, and the connection service
 * then refuses the second tab's copy of the code.
 */
export function holdSession(code: string): Promise<boolean> {
  letGoOfSession();
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request(`lectern-share-${code}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return undefined; }
      resolve(true);
      return new Promise<void>((done) => { release = done; });
    }).catch(() => resolve(true));
  });
}

export function letGoOfSession() {
  release?.();
  release = null;
}

// ─── Getting into the site ────────────────────────────────────────────

const ACCESS_KEY = 'lectern.access';
/** EdgeOne's links last three hours. */
const ACCESS_MAX = 3 * 60 * 60_000;

/**
 * What a link to this site must carry for phones to open it, when this page was itself opened with
 * such a link. Remembered, since the address can lose it while moving around the app.
 */
export function siteAccess(now = Date.now()): string {
  if (typeof window === 'undefined') return '';
  try {
    const here = accessQuery(window.location.search);
    if (here) {
      localStorage.setItem(ACCESS_KEY, JSON.stringify({ query: here, at: now }));
      return here;
    }
    const kept = JSON.parse(localStorage.getItem(ACCESS_KEY) ?? 'null') as { query?: string; at?: number } | null;
    return kept?.query && now - (kept.at ?? 0) < ACCESS_MAX ? kept.query : '';
  } catch {
    return accessQuery(window.location.search);
  }
}

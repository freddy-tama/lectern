// Small cleaners for what drafting requests send, shared by api/draft-deck.ts and api/_lib/research.ts.

/** A YYYY-MM-DD date that is a real day, or today on this server. */
export function cleanToday(raw: unknown, now = new Date()): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const t = Date.parse(`${s}T00:00:00Z`);
  // "2026-02-30" parses as 2 March, so the day must read back the same.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s) return s;
  return now.toISOString().slice(0, 10);
}

/** A language name the presenter picked: letters, spaces and brackets only, so it can't carry instructions. */
export function cleanLanguage(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, 40) : '';
  return /^[\p{L}\p{M} ()\-]+$/u.test(s) ? s : '';
}

/** "4 November 2026", so the model reads the date one way only. */
export const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });


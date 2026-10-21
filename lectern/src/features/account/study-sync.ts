// Study progress per person: when someone is signed in, the slides they mark as learning or
// known are saved to their account too, so their progress follows them to another browser
// and isn't seen by the next person on a shared computer.
//
// - Signing in brings the account's marks into this browser and sends up any newer ones
//   made here. For each slide, the newer mark wins.
// - Each new mark is saved to the account as it's made.
// - Signing out removes the marks from this browser; they stay in the account.
//
// Decks themselves stay in the browser, so marks follow a deck only where it has the same id:
// the sample decks, and decks restored from a backup or opened from a share.

import { type StudyMark, db } from '../../data/db';
import { type AccountState, accountState, onAccountChange, supabase } from './session';

interface MarkRow {
  user_id?: string;
  deck_id: string;
  slide_id: string;
  status: StudyMark['status'];
  updated_at: number;
}

const PAGE = 1000;
const keyOf = (m: Pick<StudyMark, 'deckId' | 'slideId'>) => `${m.deckId}\u0000${m.slideId}`;

const toRow = (m: StudyMark, userId: string): MarkRow => ({ user_id: userId, deck_id: m.deckId, slide_id: m.slideId, status: m.status, updated_at: m.updatedAt });
const fromRow = (r: MarkRow): StudyMark => ({ deckId: r.deck_id, slideId: r.slide_id, status: r.status, updatedAt: Number(r.updated_at) || 0 });

/** For each slide, the newer mark wins: what this browser should take, and what the account should take. */
export function mergeMarks(local: StudyMark[], remote: StudyMark[]): { toLocal: StudyMark[]; toRemote: StudyMark[] } {
  const here = new Map(local.map((m) => [keyOf(m), m]));
  const there = new Map(remote.map((m) => [keyOf(m), m]));
  const toLocal = remote.filter((m) => (here.get(keyOf(m))?.updatedAt ?? -1) < m.updatedAt);
  const toRemote = local.filter((m) => (there.get(keyOf(m))?.updatedAt ?? -1) < m.updatedAt);
  return { toLocal, toRemote };
}

const signedIn = (s: AccountState = accountState()) => (s.status === 'signed-in' ? s.user.id : '');

async function remoteMarks(): Promise<StudyMark[] | null> {
  const sb = await supabase();
  if (!sb) return null;
  const out: StudyMark[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('study_marks').select('deck_id, slide_id, status, updated_at').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data as MarkRow[]).map(fromRow));
    if (data.length < PAGE) return out;
  }
}

async function upload(marks: StudyMark[], userId: string): Promise<void> {
  const sb = await supabase();
  if (!sb || !marks.length) return;
  for (let i = 0; i < marks.length; i += PAGE) {
    const { error } = await sb.from('study_marks').upsert(marks.slice(i, i + PAGE).map((m) => toRow(m, userId)), { onConflict: 'user_id,deck_id,slide_id' });
    if (error) throw new Error(error.message);
  }
}

let syncing: Promise<void> | null = null;

/** Brings this browser and the account level with each other. Does nothing when no one is signed in. */
export function syncStudy(): Promise<void> {
  const userId = signedIn();
  if (!userId) return Promise.resolve();
  syncing ??= (async () => {
    const remote = await remoteMarks();
    if (!remote) return;
    const { toLocal, toRemote } = mergeMarks(await db.study.toArray(), remote);
    if (toLocal.length) await db.study.bulkPut(toLocal);
    await upload(toRemote, userId);
  })().catch((error) => console.error('Study progress didn’t sync', error)).finally(() => { syncing = null; });
  return syncing;
}

/** Saves one mark here, and to the account when someone is signed in. */
export async function saveMark(mark: StudyMark): Promise<void> {
  await db.study.put(mark);
  const userId = signedIn();
  if (userId) await upload([mark], userId).catch((error) => console.error('Study progress didn’t save to the account', error));
}

let watching = false;
let lastUser = '';

/** Syncs on sign-in and clears this browser's marks on sign-out. Runs once, when the app starts. */
export function startStudySync() {
  if (watching) return;
  watching = true;
  onAccountChange(() => {
    const s = accountState();
    const userId = signedIn(s);
    if (userId && userId !== lastUser) void syncStudy();
    // Someone signed out: their progress is in their account, not left for the next person here.
    if (s.status === 'signed-out' && lastUser) void db.study.clear();
    if (s.status === 'signed-in' || s.status === 'signed-out') lastUser = userId;
  });
}

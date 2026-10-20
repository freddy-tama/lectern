import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BackupCounts } from '../../data/backup';
import { type OpenedDeck, openDeckFile } from '../../data/deck-file';
import { plural } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { downloadBlob } from '../studio/download';

const LAST_KEY = 'lectern.lastBackup';

/** When this browser last saved a backup (ms), or 0. */
export function lastBackupAt(): number {
  try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; }
}

/** Makes a backup of everything and downloads it. */
export async function downloadBackup(audio = false): Promise<BackupCounts> {
  const { createBackup } = await import('../../data/backup');
  const made = await createBackup({ audio });
  downloadBlob(made.blob, made.fileName);
  try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* private mode or full */ }
  return made.counts;
}

/** "12 decks, 3 courses, 40 notes and 27 pictures": the parts that aren't zero, or "" when all are. */
export function countsText(counts: Partial<BackupCounts>): string {
  const parts = [
    counts.decks ? plural(counts.decks, 'deck') : '',
    counts.courses ? plural(counts.courses, 'course') : '',
    counts.lessons ? plural(counts.lessons, 'lesson') : '',
    counts.notes ? plural(counts.notes, 'note') : '',
    counts.recordings ? plural(counts.recordings, 'recording') : '',
    counts.pictures ? plural(counts.pictures, 'picture') : '',
    counts.audio ? plural(counts.audio, 'audio file') : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function openedText(opened: OpenedDeck) {
  const extra = [
    opened.missing ? `${plural(opened.missing, 'picture')} ${opened.missing === 1 ? 'wasn’t' : 'weren’t'} in the file` : '',
    opened.needMods ? `${plural(opened.needMods, 'slide')} ${opened.needMods === 1 ? 'needs' : 'need'} a mod this build doesn’t have; ${opened.needMods === 1 ? 'its' : 'their'} content is kept` : '',
  ].filter(Boolean);
  return `Opened “${opened.deck.title}”${extra.length ? `. ${extra.join('. ')}.` : ''}`;
}

/** Opens a .lectern.json file as a new deck, goes to it in the studio and says what came with it. Throws a readable error. */
export function useOpenDeckFile() {
  const navigate = useNavigate();
  const toast = useToast();
  return useCallback(async (file: Blob, options: { lessonId?: string } = {}) => {
    const opened = await openDeckFile(file, options);
    navigate(`/studio/${opened.deck.id}`);
    toast.show(openedText(opened), { duration: opened.missing || opened.needMods ? 8000 : 4000 });
    return opened;
  }, [navigate, toast]);
}

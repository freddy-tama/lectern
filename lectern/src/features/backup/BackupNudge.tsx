import { Archive, Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clearsIdleData, idleClearerName, usePwa } from '../../app/pwa';
import { timeAgo } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { countsText, downloadBackup, lastBackupAt } from './actions';
import { backupReminderDue, hasOwnDecks, lastReminderAt, markReminderShown } from './reminder';
import '../../styles/backup.css';

/** Preferences and Mods show the backup panel already; Notes fills the window. */
const SKIP = /^\/(settings|mods|notes)(\/|$)/;

/** Decided once a visit. Kept outside the component so the reminder survives leaving the Shell (the studio, presenting). */
let phase: 'unchecked' | 'checking' | 'open' | 'closed' = 'unchecked';
/** The last backup's time when the reminder opened: a different one means a backup was made since. */
let backupWhenOpened = 0;

/**
 * A quiet reminder at the top of the page to download a backup, when there's work of one's own
 * and no backup from the last two weeks. It shows at most once a week, and stays for the visit
 * until it's dismissed or a backup is made.
 */
export function BackupNudge() {
  const { way } = usePwa();
  const toast = useToast();
  const skip = SKIP.test(useLocation().pathname);
  const [open, setOpenState] = useState(phase === 'open');
  const [busy, setBusy] = useState(false);
  const [last] = useState(lastBackupAt);
  const setOpen = (value: boolean) => { phase = value ? 'open' : 'closed'; setOpenState(value); };

  useEffect(() => {
    if (phase !== 'unchecked' || skip) return;
    phase = 'checking';
    const now = Date.now();
    // The cheap checks first: most visits stop here without reading any decks.
    if (!backupReminderDue({ now, lastBackup: lastBackupAt(), lastShown: lastReminderAt(), hasWork: true })) {
      phase = 'closed';
      return;
    }
    hasOwnDecks().then((own) => {
      if (!own) { phase = 'closed'; return; }
      markReminderShown(now);
      backupWhenOpened = lastBackupAt();
      phase = 'open';
      setOpenState(true);
    }).catch(() => { phase = 'closed'; });
  }, [skip]);

  // A backup made elsewhere (Preferences, or another tab) answers the reminder too.
  if (!open || skip || lastBackupAt() !== backupWhenOpened) return null;

  const backUp = async () => {
    setBusy(true);
    try {
      const counts = await downloadBackup(false);
      setOpen(false);
      toast.show(`Backup saved with ${countsText(counts) || 'everything'}.`, { duration: 5000 });
    } catch (e) {
      toast.show(`The backup couldn’t be made. ${(e as Error).message}`, { tone: 'error', duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const safari = clearsIdleData(way);
  return (
    <aside className="backup-nudge" aria-label="Backup reminder">
      <div className="backup-nudge-inner">
        <Archive size={18} className="backup-nudge-icon" aria-hidden />
        <p className="backup-nudge-text">
          <strong>Back up your work.</strong>{' '}
          {last ? `It’s saved only in this browser, and the last backup was ${timeAgo(last)}.` : 'It’s saved only in this browser, and there’s no backup yet.'}
          {safari && (
            <>
              {' '}{idleClearerName()} can also clear it after 7 days without a visit.{' '}
              <Link to="/settings#your-data">Add Lectern to your {way === 'dock' ? 'Dock' : 'Home Screen'}</Link> to stop that.
            </>
          )}
        </p>
        <div className="backup-nudge-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={backUp} disabled={busy}>
            {busy ? <><span className="spinner" /> Making the backup…</> : <><Download size={15} /> Download a backup</>}
          </button>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Dismiss the backup reminder" title="Dismiss"><X size={17} /></button>
        </div>
      </div>
    </aside>
  );
}

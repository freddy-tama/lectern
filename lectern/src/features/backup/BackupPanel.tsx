import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, Download, HardDrive, ShieldAlert, ShieldCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type InstallWay, clearsIdleData, idleClearerName, usePwa } from '../../app/pwa';
import type { ConflictChoice, OpenedBackup, RestoreResult } from '../../data/backup';
import { db } from '../../data/db';
import { isDeckFile } from '../../data/deck-file';
import { type StorageUsage, formatBytes, isQuotaError, requestPersistence, storageUsage } from '../../data/storage';
import { Dialog } from '../../ui/Dialog';
import { LOCALE, plural, timeAgo } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { countsText, downloadBackup, lastBackupAt, useOpenDeckFile } from './actions';
import { InstallLectern } from './InstallLectern';
import '../../styles/backup.css';

type Restore =
  | { step: 'confirm'; backup: OpenedBackup }
  | { step: 'working'; backup: OpenedBackup }
  | { step: 'done'; result: RestoreResult };

/** Why Lectern's data isn't safe yet, pointing to installing where that's the fix. */
function atRiskText(persisted: boolean, way: InstallWay): string {
  if (clearsIdleData(way)) {
    return `${persisted ? '' : 'Not protected yet. '}${idleClearerName()} clears a site’s data after 7 days without a visit. Install Lectern to keep it.`;
  }
  const risk = 'Not protected yet. The browser may clear Lectern’s data if the disk gets full.';
  return way === 'prompt' || way === 'menu' ? `${risk} Installing Lectern is the surest fix.` : risk;
}

function madeOn(iso: string) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** Backing up everything, restoring a backup, and how much space Lectern uses in this browser. */
export function BackupPanel() {
  const toast = useToast();
  const { way } = usePwa();
  const openDeck = useOpenDeckFile();
  const fileInput = useRef<HTMLInputElement>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [audio, setAudio] = useState(false);
  const [busy, setBusy] = useState<'' | 'backup' | 'read'>('');
  const [last, setLast] = useState(lastBackupAt);
  const [restore, setRestore] = useState<Restore | null>(null);
  const [choice, setChoice] = useState<ConflictChoice>('copy');

  const totals = useLiveQuery(async () => {
    const [decks, courses, notes, recordings, pictures] = await Promise.all([
      db.decks.count(), db.courses.count(), db.notes.count(), db.recordings.toArray(), db.assets.count(),
    ]);
    const withAudio = recordings.filter((r) => r.audio);
    return {
      decks, courses, notes,
      recordings: recordings.length,
      audioBytes: withAudio.reduce((sum, r) => sum + (r.size || 0), 0),
      files: pictures,
    };
  }, []);

  const refreshUsage = useCallback(() => { storageUsage().then(setUsage); }, []);
  useEffect(refreshUsage, [refreshUsage]);

  const backUp = async () => {
    setBusy('backup');
    try {
      const counts = await downloadBackup(audio);
      setLast(Date.now());
      toast.show(countsText(counts) ? `Backup saved with ${countsText(counts)}.` : 'Backup saved. There’s nothing in it yet.', { duration: 5000 });
    } catch (e) {
      toast.show(`The backup couldn’t be made. ${(e as Error).message}`, { tone: 'error', duration: 8000 });
    } finally {
      setBusy('');
    }
  };

  const pick = async (file: File) => {
    setBusy('read');
    try {
      if (await isDeckFile(file)) {
        await openDeck(file);
        return;
      }
      const { openBackup } = await import('../../data/backup');
      const backup = await openBackup(file);
      setChoice('copy');
      setRestore({ step: 'confirm', backup });
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error', duration: 8000 });
    } finally {
      setBusy('');
    }
  };

  const run = async (backup: OpenedBackup) => {
    setRestore({ step: 'working', backup });
    try {
      const { restoreBackup } = await import('../../data/backup');
      const result = await restoreBackup(backup, choice);
      setRestore({ step: 'done', result });
      refreshUsage();
    } catch (e) {
      setRestore(null);
      toast.show(isQuotaError(e)
        ? 'Couldn’t restore. There isn’t enough space in this browser. Free some space, or restore a backup made without recordings’ audio.'
        : `Couldn’t restore the backup. ${(e as Error).message}`, { tone: 'error', duration: 10_000 });
    }
  };

  const protect = async () => {
    const ok = await requestPersistence();
    refreshUsage();
    const canInstall = way !== 'installed' && way !== 'none';
    toast.show(ok ? 'This browser will keep Lectern’s data.' : canInstall
      ? 'The browser said no for now. Installing Lectern is the surest way to keep its data.'
      : 'The browser said no for now. Browsers often agree once a site is used more.', { duration: 6000 });
  };

  // Chrome and Edge keep an installed app's data, so ask again straight after installing.
  const installed = () => { requestPersistence().finally(refreshUsage); };

  const share = usage && usage.quota ? Math.min(100, (usage.usage / usage.quota) * 100) : 0;

  return (
    <div className="backup">
      <p className="prose">Everything you make lives in this browser only. Download a backup now and then, and before you clear browsing data or move to another computer.</p>

      <section className="card backup-usage" aria-labelledby="usage-title">
        <div className="backup-usage-head">
          <HardDrive size={18} aria-hidden />
          <h3 id="usage-title">Storage</h3>
          {usage && (
            <span className="faint">{formatBytes(usage.usage)} used{usage.quota ? ` of about ${formatBytes(usage.quota)}` : ''}</span>
          )}
        </div>
        {usage && usage.quota > 0 && (
          <div className="progress" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)} aria-label="Storage used">
            <span style={{ width: `${Math.max(share, 1)}%`, ...(share > 85 ? { background: 'var(--danger)' } : {}) }} />
          </div>
        )}
        {totals && (
          <p className="faint backup-totals">
            {[plural(totals.decks, 'deck'), plural(totals.courses, 'course'), plural(totals.notes, 'note'), plural(totals.recordings, 'recording'), plural(totals.files, 'stored file')].join(' · ')}
            {totals.audioBytes > 0 && ` · ${formatBytes(totals.audioBytes)} of audio`}
          </p>
        )}
        {usage && (usage.persisted && !clearsIdleData(way) ? (
          <p className="backup-persist"><ShieldCheck size={16} aria-hidden /><span>Protected. The browser won’t clear Lectern’s data to make space.</span></p>
        ) : (
          <p className="backup-persist">
            <ShieldAlert size={16} aria-hidden />
            <span>{atRiskText(usage.persisted, way)}</span>
            {!usage.persisted && <button type="button" className="btn btn-ghost btn-sm" onClick={protect}>Ask to keep it</button>}
          </p>
        ))}
        {!usage && <p className="faint">This browser doesn’t say how much space Lectern uses.</p>}
        <InstallLectern way={way} onInstalled={installed} />
      </section>

      <div className="backup-actions">
        <article className="card backup-card">
          <h3><Archive size={17} aria-hidden /> Back up</h3>
          <p className="muted">One .zip file with every deck and its pictures, your courses, lessons, notes, looks, study progress and recordings’ transcripts.</p>
          <label className="switch">
            <input type="checkbox" checked={audio} disabled={!totals?.audioBytes} onChange={(e) => setAudio(e.target.checked)} />
            <span>Include recordings’ audio{totals?.audioBytes ? ` (${formatBytes(totals.audioBytes)})` : ''}</span>
          </label>
          <div className="backup-card-foot">
            <button type="button" className="btn btn-primary" onClick={backUp} disabled={Boolean(busy)}>
              {busy === 'backup' ? <><span className="spinner" /> Making the backup…</> : <><Download size={16} /> Download a backup</>}
            </button>
            <span className="faint">{last ? `Last backup ${timeAgo(last)}` : 'No backup from this browser yet'}</span>
          </div>
        </article>

        <article className="card backup-card">
          <h3><Upload size={17} aria-hidden /> Restore</h3>
          <p className="muted">Adds a backup’s contents to this browser. Nothing here is deleted. You can also choose a Lectern deck file to open it as a new deck.</p>
          <div className="backup-card-foot">
            <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
              {busy === 'read' ? <><span className="spinner" /> Reading the file…</> : <><Upload size={16} /> Restore from a backup</>}
            </button>
          </div>
          <input ref={fileInput} type="file" accept=".zip,.json,application/zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
        </article>
      </div>

      <RestoreDialog
        restore={restore}
        choice={choice}
        onChoice={setChoice}
        onRun={run}
        onClose={() => { if (restore?.step !== 'working') setRestore(null); }}
      />
    </div>
  );
}

function RestoreDialog({ restore, choice, onChoice, onRun, onClose }: {
  restore: Restore | null;
  choice: ConflictChoice;
  onChoice(c: ConflictChoice): void;
  onRun(b: OpenedBackup): void;
  onClose(): void;
}) {
  if (restore?.step === 'done') {
    const r = restore.result;
    const updated = countsText(r.updated);
    const lines = [
      updated ? `Updated ${updated} with the backup’s newer copies.` : '',
      r.decksReplaced ? `Replaced ${plural(r.decksReplaced, 'deck')} with the backup’s copy.` : '',
      r.decksCopied ? `Kept ${plural(r.decksCopied, 'deck')} side by side. The backup’s copies end in “(from backup)”.` : '',
      r.looks ? `Added ${plural(r.looks, 'look')}.` : '',
      r.withoutAudio ? `${plural(r.withoutAudio, 'recording')} came back with the transcript only, because the backup has no audio.` : '',
    ].filter(Boolean);
    const added = countsText(r.added);
    return (
      <Dialog
        open
        onClose={onClose}
        title="Backup restored"
        footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}
      >
        <div className="backup-result">
          {added && <p><strong>Added {added}.</strong></p>}
          {lines.length > 0 && <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
          {!added && <p className={lines.length ? 'faint' : undefined}>{lines.length ? 'Everything else in the backup was already here.' : 'Nothing new to add. This browser already had everything in the backup.'}</p>}
        </div>
      </Dialog>
    );
  }

  const backup = restore?.backup;
  const working = restore?.step === 'working';
  const date = backup ? madeOn(backup.manifest.exportedAt) : '';
  const conflicts = backup?.conflicts ?? [];
  return (
    <Dialog
      open={Boolean(backup)}
      onClose={onClose}
      title="Restore this backup?"
      description={backup ? `${date ? `Made on ${date}. ` : ''}${countsText(backup.counts) ? `It has ${countsText(backup.counts)}.` : 'It’s empty.'}` : undefined}
      footer={backup && (
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onRun(backup)} disabled={working}>
            {working ? <><span className="spinner" /> Restoring…</> : 'Restore'}
          </button>
        </>
      )}
    >
      {backup && (
        <div className="backup-confirm">
          <p>Everything in this browser stays. New items are added, and where both have the same item, the one changed last is kept.</p>
          {!backup.manifest.audio && backup.counts.recordings > 0 && (
            <p className="faint">This backup has recordings’ transcripts but not their audio.</p>
          )}
          {conflicts.length > 0 && (
            <fieldset className="backup-conflicts">
              <legend>{conflicts.length === 1 ? 'One deck is here and in the backup, with different changes:' : `${conflicts.length} decks are here and in the backup, with different changes:`}</legend>
              <ul>
                {conflicts.slice(0, 4).map((c) => <li key={c.id}>{c.title}{c.newerHere ? <span className="faint"> · changed here since the backup</span> : null}</li>)}
                {conflicts.length > 4 && <li className="faint">and {plural(conflicts.length - 4, 'more deck')}</li>}
              </ul>
              <label className="backup-choice">
                <input type="radio" name="deck-conflict" checked={choice === 'copy'} onChange={() => onChoice('copy')} />
                <span><strong>Keep both</strong><span className="faint">Add the backup’s copy as a separate deck</span></span>
              </label>
              <label className="backup-choice">
                <input type="radio" name="deck-conflict" checked={choice === 'replace'} onChange={() => onChoice('replace')} />
                <span><strong>Replace with the backup’s copy</strong><span className="faint">The version here is overwritten</span></span>
              </label>
            </fieldset>
          )}
        </div>
      )}
    </Dialog>
  );
}

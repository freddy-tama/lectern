// "Hand out a copy": the quiz and the slides as QR codes and single-file web
// pages, for rooms where the live connection won't work.

import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileText, Presentation, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../../data/db';
import { useToast } from '../../ui/Toast';
import { downloadBlob, safeName } from '../studio/download';
import { CopyLink } from './CopyLink';
import { type OfflineCopies, offlineCopies } from './offline';
import { QrCode } from './QrCode';

function html(text: string) {
  return new Blob([text], { type: 'text/html;charset=utf-8' });
}

function NoQr({ children }: { children: React.ReactNode }) {
  return <div className="offline-noqr" role="note">{children}</div>;
}

export function OfflinePanel({ deckId }: { deckId: string }) {
  const deck = useLiveQuery(() => db.decks.get(deckId), [deckId]);
  const toast = useToast();
  const [copies, setCopies] = useState<OfflineCopies | null>(null);
  const [tab, setTab] = useState<'quiz' | 'slides' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!deck) return;
    let alive = true;
    offlineCopies(deck).then((c) => { if (alive) setCopies(c); }).catch(() => {});
    return () => { alive = false; };
  }, [deck]);

  if (!deck || !copies) return <div className="offline"><p className="muted">Getting copies ready…</p></div>;
  const shown = tab ?? (copies.quiz ? 'quiz' : 'slides');
  const name = safeName(deck.title);

  const saveQuiz = async () => {
    if (!copies.quiz) return;
    const { quizHtml } = await import('./standalone');
    downloadBlob(html(quizHtml(copies.quiz.pack)), `${name} quiz.html`);
  };
  const saveSlides = async (kind: 'full' | 'text') => {
    setBusy(true);
    try {
      const { deckHtml, slidesLiteHtml } = await import('./standalone');
      const text = kind === 'full' ? await deckHtml(deck) : slidesLiteHtml(copies.slides.pack);
      downloadBlob(html(text), kind === 'full' ? `${name}.html` : `${name} (text).html`);
    } catch (e) {
      toast.show(`Couldn’t make the file. ${(e as Error).message}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="offline">
      <p className="muted offline-lead">
        These run on each phone by themselves, so there’s no live connection to drop. Phones need the internet to open the link. With no internet at all, download a file and send it round.
      </p>
      <div className="segmented share-tabs" role="tablist" aria-label="What to hand out">
        <button type="button" role="tab" aria-selected={shown === 'quiz'} onClick={() => setTab('quiz')}>
          <Trophy size={15} /> Quiz{copies.quiz ? <span className="share-tab-count">{copies.quiz.pack.items.length}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={shown === 'slides'} onClick={() => setTab('slides')}><Presentation size={15} /> Slides</button>
      </div>

      {shown === 'quiz' ? (
        copies.quiz ? (
          <div className="share-code" role="tabpanel">
            {copies.quiz.fits
              ? <QrCode value={copies.quiz.url} level="L" label="QR code for the quiz" />
              : <NoQr>Too many questions for one QR code. Download the quiz and share the file.</NoQr>}
            <div className="share-code-text">
              <p className="share-code-lead">{copies.quiz.fits ? 'Scan to take the quiz' : 'Share the quiz as a file'}</p>
              <p className="muted">
                {copies.quiz.pack.items.length} questions{copies.quiz.made ? ', made from your key notes' : ''}. Each phone marks its own answers and shows a score at the end.
              </p>
              <div className="share-code-actions">
                {copies.quiz.fits && <CopyLink url={copies.quiz.url} />}
                <button type="button" className="btn btn-secondary btn-sm" onClick={saveQuiz}><Download size={15} /> Download (.html)</button>
              </div>
            </div>
          </div>
        ) : (
          <p className="share-note" role="tabpanel">Nothing to quiz on yet. Mark the right choice on a question slide, or add a check question to a few slides’ key notes.</p>
        )
      ) : (
        <div className="share-code" role="tabpanel">
          {copies.slides.fits
            ? <QrCode value={copies.slides.url} level="L" label="QR code for a text-only copy of the slides" />
            : <NoQr>Too much text for one QR code. Download the slides and share the file.</NoQr>}
          <div className="share-code-text">
            <p className="share-code-lead">{copies.slides.fits ? 'Scan to read along' : 'Share the slides as a file'}</p>
            <p className="muted">
              {copies.slides.fits ? `The words from all ${copies.slides.pack.slides.length} slides, sized for a phone. ` : ''}
              The download is the full deck as one web page: view only, with your reveals, and no notes or script.
            </p>
            <div className="share-code-actions">
              {copies.slides.fits && <CopyLink url={copies.slides.url} />}
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => saveSlides('full')}>
                {busy ? <span className="spinner" /> : <Download size={15} />} Slides (.html)
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveSlides('text')}><FileText size={15} /> Text only</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

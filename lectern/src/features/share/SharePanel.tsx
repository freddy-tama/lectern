// The share window on the presenter's computer, and the "Live" badge that stays
// on screen while phones are connected. Mounted once for the whole app.

import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Laptop, MonitorUp, QrCode as QrIcon, Radio, RotateCcw, ScrollText, Smartphone, Tablet, Trophy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { type GuestInfo, liveHost, useLiveHost } from './host';
import { CopyLink } from './CopyLink';
import { OfflinePanel } from './OfflinePanel';
import { QrCode } from './QrCode';
import { QuizPanel, QuizSettingsRow } from './QuizPanel';
import { quizItem } from '../../core/share/quiz';
import { formatCode, joinUrl, pollChoices } from '../../core/share/protocol';
import { db } from '../../data/db';
import { Dialog } from '../../ui/Dialog';
import { isSupported } from './peer';

function isLocalOrigin() {
  return /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(window.location.hostname);
}

function DeviceIcon({ device }: { device: string }) {
  if (/iPad|tablet/i.test(device)) return <Tablet size={16} />;
  if (/iPhone|phone/i.test(device)) return <Smartphone size={16} />;
  return <Laptop size={16} />;
}

function DeviceList({ guests }: { guests: GuestInfo[] }) {
  if (!guests.length) return <p className="share-empty muted">No one has joined yet. Devices show up here as they connect.</p>;
  const viewers = guests.filter((g) => g.role === 'audience').length;
  return (
    <div className="share-devices">
      <p className="eyebrow">{guests.length === 1 ? '1 device' : `${guests.length} devices`}{viewers ? ` · ${viewers} watching` : ''}</p>
      <ul>
        {guests.slice(0, 8).map((g) => (
          <li key={g.id}>
            <DeviceIcon device={g.device} />
            <span>{g.device}</span>
            {g.role === 'presenter' ? <span className="chip chip-brand">Your phone</span> : <span className="chip">Watching</span>}
            {!g.ready && <span className="faint share-arriving">getting slides…</span>}
          </li>
        ))}
      </ul>
      {guests.length > 8 && <p className="faint">and {guests.length - 8} more</p>}
    </div>
  );
}

function PollResults({ deckId }: { deckId: string }) {
  const live = useLiveHost();
  const deck = useLiveQuery(() => db.decks.get(deckId), [deckId]);
  const slides = deck?.slides.filter((s) => !s.hidden) ?? [];
  const slide = slides[live.state?.index ?? 0];
  const choices = pollChoices(slide);
  // Scored questions show in the Quiz tab instead.
  if (!slide || !choices || (live.quizSettings.on && quizItem(slide))) return null;
  const result = live.votes[slide.id];
  const total = result?.total ?? 0;
  return (
    <section className="share-poll" aria-label="Poll answers">
      <div className="share-poll-head">
        <p className="eyebrow">Answers to slide {(live.state?.index ?? 0) + 1}</p>
        <span className="faint">{total === 1 ? '1 answer' : `${total} answers`}</span>
        {total > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => liveHost.clearVotes(slide.id)}><RotateCcw size={14} /> Clear</button>}
      </div>
      <ol>
        {choices.map((c, i) => {
          const n = result?.counts[i] ?? 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return (
            <li key={i}>
              <span className="share-poll-label"><b>{String.fromCharCode(65 + i)}</b> {c}</span>
              <span className="share-poll-bar"><span style={{ width: `${pct}%` }} /></span>
              <span className="share-poll-n tabular">{n}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StartView({ deckId, onOffline }: { deckId: string; onOffline(): void }) {
  const live = useLiveHost();
  const other = live.status === 'live' && live.deckId !== deckId;
  return (
    <div className="share-start">
      <div className="share-roles">
        <div className="share-role">
          <span className="share-role-icon"><ScrollText size={20} /></span>
          <strong>Your phone</strong>
          <p className="muted">Your script as a teleprompter, the next slide, a timer, and big buttons to move the slides.</p>
        </div>
        <div className="share-role">
          <span className="share-role-icon"><Users size={20} /></span>
          <strong>Everyone else</strong>
          <p className="muted">Slides on their phone as you present, answers to your questions, and the deck to keep.</p>
        </div>
      </div>
      <fieldset className="share-options">
        <legend className="field-label">What viewers get</legend>
        <label className="switch"><input type="checkbox" checked={live.options.allowDownload} onChange={(e) => liveHost.setOptions({ allowDownload: e.target.checked })} /><span>Let them save the PowerPoint</span></label>
        <label className="switch"><input type="checkbox" checked={live.options.shareTakeaways} onChange={(e) => liveHost.setOptions({ shareTakeaways: e.target.checked })} /><span>Show the takeaways under each slide</span></label>
        <label className="switch"><input type="checkbox" checked={live.options.polls} onChange={(e) => liveHost.setOptions({ polls: e.target.checked })} /><span>Let them answer question slides</span></label>
        <p className="field-help">Your script, cues and private notes stay on your devices.</p>
      </fieldset>
      <fieldset className="share-options">
        <legend className="field-label">Quiz</legend>
        <QuizSettingsRow />
      </fieldset>
      {other && <p className="share-note">You’re sharing “{live.title}”. Starting here stops that.</p>}
      {isLocalOrigin() && <p className="share-note">Phones can’t open this computer’s local address. Share from Lectern’s web address, or open Lectern using this computer’s network address.</p>}
      {live.status === 'error' && live.error ? (
        <div className="share-note share-error share-fallback" role="alert">
          <p>{live.error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onOffline}><QrIcon size={15} /> Hand out a copy instead</button>
        </div>
      ) : (
        <button type="button" className="share-offline-link" onClick={onOffline}>
          <QrIcon size={15} /> No connection in this room? <span>Hand out a copy by QR code</span>
        </button>
      )}
    </div>
  );
}

function LiveView({ onOffline }: { onOffline(): void }) {
  const live = useLiveHost();
  const [tab, setTab] = useState<'audience' | 'presenter' | 'quiz'>('audience');
  const origin = window.location.origin;
  const code = live.code ?? '';
  const audienceUrl = joinUrl(origin, code);
  const presenterUrl = joinUrl(origin, code, live.token ?? undefined);
  return (
    <div className="share-live">
      <div className="segmented share-tabs" role="tablist" aria-label="Who is joining">
        <button type="button" role="tab" aria-selected={tab === 'audience'} onClick={() => setTab('audience')}><Users size={15} /> Audience</button>
        <button type="button" role="tab" aria-selected={tab === 'presenter'} onClick={() => setTab('presenter')}><Smartphone size={15} /> Your phone</button>
        <button type="button" role="tab" aria-selected={tab === 'quiz'} onClick={() => setTab('quiz')}>
          <Trophy size={15} /> Quiz{live.quiz?.questions ? <span className="share-tab-count">{live.quiz.questions}</span> : null}
        </button>
      </div>
      {tab === 'quiz' && live.deckId ? <QuizPanel deckId={live.deckId} /> : tab === 'audience' ? (
        <div className="share-code" role="tabpanel">
          <QrCode value={audienceUrl} label="QR code to follow the slides" />
          <div className="share-code-text">
            <p className="share-code-lead">Scan to follow along</p>
            <p className="muted">or go to <strong>{window.location.host}/join</strong> and enter</p>
            <p className="share-code-big tabular" aria-label={`Code ${[...code].join(' ')}`}>{formatCode(code)}</p>
            <div className="share-code-actions">
              <CopyLink url={audienceUrl} />
              <label className="switch"><input type="checkbox" checked={live.onScreen} onChange={(e) => liveHost.showOnScreen(e.target.checked)} /><span><MonitorUp size={14} /> Show on the big screen</span></label>
            </div>
          </div>
        </div>
      ) : (
        <div className="share-code" role="tabpanel">
          <QrCode value={presenterUrl} label="QR code for your phone" className="qr-private" />
          <div className="share-code-text">
            <p className="share-code-lead">Scan with your phone</p>
            <p className="muted">It becomes your teleprompter and remote. This code controls the slides, so keep it to yourself.</p>
            <div className="share-code-actions"><CopyLink url={presenterUrl} /></div>
          </div>
        </div>
      )}
      {live.error && <p className="share-note share-error" role="status">{live.error}</p>}
      {tab !== 'quiz' && live.deckId && <PollResults deckId={live.deckId} />}
      {tab !== 'quiz' && <DeviceList guests={live.guests} />}
      {tab === 'audience' && (
        <button type="button" className="share-offline-link" onClick={onOffline}>
          <QrIcon size={15} /> Some phones can’t connect? <span>Hand out a copy</span>
        </button>
      )}
    </div>
  );
}

export function SharePanel() {
  const live = useLiveHost();
  const { pathname } = useLocation();
  const deckId = live.panel.deckId;
  const open = live.panel.open && !!deckId;
  const showingThis = live.status === 'live' && live.deckId === deckId;
  const deck = useLiveQuery(() => (deckId ? db.decks.get(deckId) : undefined), [deckId]);
  const [offline, setOffline] = useState(false);
  useEffect(() => { if (!open) setOffline(false); }, [open]);

  // Stop sharing when this tab closes, so phones hear about it right away.
  useEffect(() => {
    const onHide = () => { if (liveHost.snapshot.status === 'live') liveHost.stop(); };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const hidePill = /^\/(present|join|welcome)/.test(pathname) || open || live.status !== 'live';
  const viewers = live.guests.filter((g) => g.role === 'audience').length;
  const phone = live.guests.some((g) => g.role === 'presenter');

  return (
    <>
      {!hidePill && (
        <button type="button" className="live-pill" onClick={() => live.deckId && liveHost.openPanel(live.deckId)} title="Sharing to phones">
          <span className="live-dot" aria-hidden />
          <span><strong>Live</strong> · {formatCode(live.code ?? '')}</span>
          <span className="live-pill-count">{phone && <Smartphone size={14} aria-label="Your phone is connected" />}<Users size={14} aria-hidden /> {viewers}</span>
        </button>
      )}
      <Dialog
        open={open}
        onClose={() => liveHost.closePanel()}
        title={offline ? 'Hand out a copy' : showingThis ? <span className="share-title"><span className="live-dot" aria-hidden /> Sharing “{live.title}”</span> : 'Share to phones'}
        description={offline ? (deck ? `“${deck.title}” without the live connection.` : undefined) : showingThis ? undefined : deck ? `“${deck.title}” on any phone, with no app to install.` : undefined}
        className="share-dialog"
        footer={
          offline ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setOffline(false)}><ArrowLeft size={16} /> Live sharing</button>
              <button type="button" className="btn btn-primary" onClick={() => liveHost.closePanel()}>Done</button>
            </>
          ) : showingThis ? (
            <>
              <button type="button" className="btn btn-ghost share-stop" onClick={() => liveHost.stop()}>Stop sharing</button>
              <button type="button" className="btn btn-primary" onClick={() => liveHost.closePanel()}>Done</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => liveHost.closePanel()}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!deckId || live.status === 'starting' || !isSupported()} onClick={() => deckId && void liveHost.start(deckId)}>
                <Radio size={16} /> {live.status === 'starting' ? 'Getting a code…' : 'Start sharing'}
              </button>
            </>
          )
        }
      >
        {deckId && (offline ? <OfflinePanel deckId={deckId} /> : showingThis ? <LiveView onOffline={() => setOffline(true)} /> : <StartView deckId={deckId} onOffline={() => setOffline(true)} />)}
      </Dialog>
    </>
  );
}

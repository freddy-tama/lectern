// Where a phone lands after scanning a QR code: /join/<code>. /join on its own asks
// for the code, and lists decks this phone already received so they open offline.

import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, LoaderCircle, Presentation, RotateCcw, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { formatCode, normalizeCode, tokenFromHash } from '../../core/share/protocol';
import { timeAgo } from '../../ui/format';
import { Logo } from '../../ui/Logo';
import { liveLink, sharedDecks, useLiveLink } from './guest';
import { isSupported } from './peer';
import { PhoneDeck } from './PhoneDeck';

function CodeForm({ initial = '' }: { initial?: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const code = normalizeCode(value);
  return (
    <form className="join-form" onSubmit={(e) => { e.preventDefault(); if (code) navigate(`/join/${code}`); }}>
      <label className="field-label" htmlFor="join-code">Code</label>
      <input
        id="join-code"
        className="join-input tabular"
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 7))}
        placeholder="ABC 123"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="go"
        autoFocus
      />
      <button type="submit" className="btn btn-primary join-go" disabled={!code}>Join <ArrowRight size={18} /></button>
    </form>
  );
}

function Saved() {
  const navigate = useNavigate();
  const decks = useLiveQuery(sharedDecks, []);
  if (!decks?.length) return null;
  return (
    <section className="join-saved">
      <p className="eyebrow">Saved on this phone</p>
      <ul>
        {decks.slice(0, 6).map((d) => (
          <li key={d.deckId}>
            <button type="button" onClick={() => navigate(`/phone/${d.deckId}`)}>
              {d.role === 'presenter' ? <Smartphone size={18} /> : <Presentation size={18} />}
              <span><strong>{d.title}</strong><span className="faint">{d.role === 'presenter' ? 'Your teleprompter' : 'Slides'} · {timeAgo(d.at)}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="join">
      <header className="join-head"><Logo /></header>
      <main className="join-main">{children}</main>
    </div>
  );
}

export default function JoinPage() {
  const { code: raw = '' } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const link = useLiveLink();
  const code = normalizeCode(raw);
  const token = tokenFromHash(hash);

  useEffect(() => { if (code && isSupported()) liveLink.join(code, token); }, [code, token]);

  const leave = () => { liveLink.leave(); navigate('/join'); };

  if (!raw || (!code && raw)) {
    return (
      <Frame>
        <h1 className="display join-title">Join a presentation</h1>
        <p className="muted">Enter the code on the presenter’s screen.</p>
        {raw && !code && <p className="join-error" role="alert">“{raw}” isn’t a code. Codes have six letters and numbers.</p>}
        <CodeForm />
        <Saved />
      </Frame>
    );
  }

  if (!isSupported()) {
    return <Frame><h1 className="display join-title">This browser can’t join</h1><p className="muted">Open this link in Chrome, Safari or Edge.</p></Frame>;
  }

  if (link.code === code && link.deckId && link.role && ['ready', 'reconnecting', 'ended'].includes(link.status)) {
    return <PhoneDeck deckId={link.deckId} role={link.role} onLeave={leave} />;
  }

  if (link.status === 'error') {
    return (
      <Frame>
        <h1 className="display join-title">Couldn’t join {formatCode(code)}</h1>
        <p className="muted">{link.error}</p>
        <div className="join-actions">
          <button type="button" className="btn btn-primary" onClick={() => liveLink.retry()}><RotateCcw size={16} /> Try again</button>
          <button type="button" className="btn btn-secondary" onClick={leave}>Enter another code</button>
        </div>
        <Saved />
      </Frame>
    );
  }

  const pct = Math.round(link.progress * 100);
  return (
    <Frame>
      <div className="join-wait" aria-live="polite">
        <div className="join-ring" style={{ '--p': `${link.status === 'receiving' ? pct : 8}%` } as React.CSSProperties}>
          {link.status === 'receiving' ? <span className="tabular">{pct}%</span> : <LoaderCircle className="spin" size={28} />}
        </div>
        <h1 className="display join-title">{link.title || 'Connecting…'}</h1>
        <p className="muted">
          {link.status === 'receiving'
            ? (link.role === 'presenter' ? 'Getting your script and slides…' : 'Getting the slides…')
            : `Finding presentation ${formatCode(code)}…`}
        </p>
      </div>
    </Frame>
  );
}

/** /phone/<deckId>: a deck this phone received earlier, opened without a connection. */
export function SavedDeck() {
  const { deckId = '' } = useParams();
  const navigate = useNavigate();
  const record = useLiveQuery(() => sharedDecks().then((list) => list.find((d) => d.deckId === deckId) ?? null), [deckId]);
  if (record === undefined) return <div className="phone phone-loading"><LoaderCircle className="spin" /></div>;
  return <PhoneDeck deckId={deckId} role={record?.role ?? 'audience'} options={record?.options} onLeave={() => navigate('/join')} />;
}

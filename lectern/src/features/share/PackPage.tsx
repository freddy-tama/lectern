// /pack#… : a quiz or text-only slides carried inside the link itself (from a
// QR code). Runs entirely on the phone, and can be saved as a file for later.

import { Download, Link2Off } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { type Pack, decodePack } from '../../core/share/pack';
import { downloadBlob, safeName } from '../studio/download';
import { quizHtml, slidesLiteHtml } from './standalone';

type View = { status: 'loading' } | { status: 'bad' } | { status: 'ok'; pack: Pack; html: string };

export function PackPage() {
  const { hash } = useLocation();
  const [view, setView] = useState<View>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    decodePack(hash.slice(1)).then((pack) => {
      if (!alive) return;
      if (!pack) { setView({ status: 'bad' }); return; }
      setView({ status: 'ok', pack, html: pack.t === 'quiz' ? quizHtml(pack) : slidesLiteHtml(pack) });
      document.title = `${pack.title} · Lectern`;
    });
    return () => { alive = false; };
  }, [hash]);

  if (view.status === 'loading') return <div className="pack-page pack-center"><span className="spinner" aria-label="Opening" /></div>;
  if (view.status === 'bad') {
    return (
      <div className="pack-page pack-center">
        <div className="pack-bad">
          <Link2Off size={28} aria-hidden />
          <h1>This link is incomplete</h1>
          <p className="muted">Part of it went missing on the way. Scan the code again, or ask for the file instead.</p>
          <Link to="/join" className="btn btn-secondary">Join with a code</Link>
        </div>
      </div>
    );
  }

  const { pack, html } = view;
  const save = () => downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${safeName(pack.title)}${pack.t === 'quiz' ? ' quiz' : ''}.html`);
  return (
    <div className="pack-page">
      <header className="pack-bar">
        <span className="pack-brand">Lectern</span>
        <span className="pack-kind">{pack.t === 'quiz' ? 'Quiz' : 'Slides'} · works offline</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={save}><Download size={15} /> Save</button>
      </header>
      <iframe className="pack-frame" title={pack.title} srcDoc={html} sandbox="allow-scripts" />
    </div>
  );
}

import { Check, Play, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { tryHref } from '../../app/try-samples';
import { QR_MAX, encodePack, fitsQr, packUrl } from '../../core/share/pack';
import { quizPackFor } from '../share/offline';
import { QrCode } from '../share/QrCode';
import { Cta } from './Cta';
import { markWelcomed, useMedia, useSeen } from './hooks';
import { TALK_ID, qrOrigin, sampleDeck } from './samples';

const LIVE = [
  'Your phone becomes the remote and teleprompter: script, next slide, timer, big buttons.',
  'The room follows on their own phones and answers polls.',
  'A scored quiz with a countdown, a leaderboard and a podium. Save the results as .csv.',
];

/** Hosts a phone on the same Wi-Fi can't reach, so the code only works from the live site. */
function isLocalHost(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch { return false; }
}

/**
 * The sample talk's quiz as a link: the questions are packed into the part after the #,
 * so the phone that scans it scores them itself. Nothing here talks to a server.
 */
export function PhoneQuiz() {
  const deck = useMemo(() => sampleDeck(TALK_ID), []);
  const quiz = useMemo(() => (deck ? quizPackFor(deck) : null), [deck]);
  const [encoded, setEncoded] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const touch = useMedia('(hover: none) and (pointer: coarse)');
  const narrow = useMedia('(max-width: 639px)');
  const compact = touch || narrow;

  useEffect(() => {
    if (!quiz) return;
    let alive = true;
    encodePack(quiz.pack).then((e) => alive && setEncoded(e), () => alive && setFailed(true));
    return () => { alive = false; };
  }, [quiz]);

  const count = quiz?.pack.items.length ?? 0;
  const origin = qrOrigin();
  const scanUrl = encoded ? packUrl(origin, encoded) : '';
  const hereUrl = encoded ? packUrl(window.location.origin, encoded) : '';

  return (
    <section id="phone-quiz" className="lp-section pq" aria-labelledby="pq-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head">
          <p className="lp-eyebrow">Phones and quiz</p>
          <h2 id="pq-title" className="lp-h2">The quiz is <em>in the link.</em></h2>
          <p className="lp-sub">
            Scan the code. Your phone opens the sample talk's {count} questions and scores them itself. The questions
            travel inside the link, after the #, which browsers don't send to the server. Nothing to install, no sign-in.
          </p>
        </div>

        <div className="pq-layout">
          <div className="pq-live">
            <h3 className="pq-h3">When you present live</h3>
            <ul className="pq-list">
              {LIVE.map((l) => <li key={l}><Check size={16} aria-hidden /> <span>{l}</span></li>)}
            </ul>
            <p className="pq-fine">
              Live sharing finds phones through a public signalling server (PeerJS), then connects devices directly over
              WebRTC. Start it with Share in present mode or in any deck. Needs a network and a second device.
            </p>
            <div className="pq-ctas">
              <Cta to={tryHref('talk', 'present')} variant="quiet"><Play size={15} aria-hidden /> Present the sample talk</Cta>
            </div>
          </div>

          {!quiz ? (
            <p className="pq-empty">The sample talk has no questions in this build, so there is no quiz to scan.</p>
          ) : compact ? (
            <div className="pq-phone-only">
              <QuizLink href={hereUrl} failed={failed} className="lp-btn-lg pq-wide">
                <Smartphone size={18} aria-hidden /> Take the quiz on this phone
              </QuizLink>
              <p className="pq-caption">On a laptop, this spot shows a code to scan.</p>
            </div>
          ) : (
            <div className="pq-scan">
              <div className="pq-code-col">
                <div className="pq-qr-card">
                  <div className="pq-qr-box">
                    {scanUrl && fitsQr(scanUrl)
                      ? <QrCode value={scanUrl} label="QR code: sample talk quiz" level="M" />
                      : <span className="pq-qr-wait">{failed ? 'No code: this browser could not pack the quiz.' : scanUrl ? 'Too long for a code.' : 'Making the code…'}</span>}
                  </div>
                </div>
                {failed && !scanUrl
                  ? <p className="pq-caption" role="alert">The quiz link could not be made here.</p>
                  : (
                    <p className="pq-caption">
                      {scanUrl
                        ? <>Link length: {scanUrl.length} characters. Lectern keeps quiz links under {QR_MAX} so the code scans from across a room.</>
                        : 'Packing the questions into the link…'}
                      {scanUrl && isLocalHost(origin) && <> Phones can scan this on the live site.</>}
                    </p>
                  )}
                <QuizLink href={hereUrl} failed={failed} className="pq-here">Take the quiz in this browser</QuizLink>
              </div>
              <QuizFrame title={deck?.title ?? ''} pack={quiz.pack} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function QuizLink({ href, failed, className, children }: { href: string; failed: boolean; className?: string; children: React.ReactNode }) {
  if (!href) {
    return <span className={`lp-btn lp-btn-brand is-waiting ${className ?? ''}`} aria-disabled="true">{failed ? 'Quiz unavailable here' : 'Preparing the quiz…'}</span>;
  }
  return <a className={`lp-btn lp-btn-brand ${className ?? ''}`} href={href} onClick={markWelcomed} data-testid="quiz-open-here">{children}</a>;
}

/** The page a phone opens, drawn in a phone-sized frame once the section is near the screen. */
function QuizFrame({ title, pack }: { title: string; pack: NonNullable<ReturnType<typeof quizPackFor>>['pack'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!seen) return;
    let alive = true;
    // The quiz page builder brings react-dom/server and the database with it, so it loads only here.
    import('../share/standalone')
      .then(({ quizHtml }) => alive && setHtml(quizHtml(pack)))
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [seen, pack]);

  return (
    <figure className="pq-frame-col">
      <div ref={ref} className="pq-phone">
        <div className="pq-phone-screen">
          {html
            ? <iframe className="pq-iframe" sandbox="allow-scripts" srcDoc={html} title={`Quiz preview: ${title}`} loading="lazy" />
            : <div className="pq-skeleton" aria-hidden={!error}>{error ? 'The preview could not load. The link above still works.' : 'Quiz preview'}</div>}
        </div>
      </div>
      <figcaption className="pq-caption">The same page your phone opens. Answers here stay in this frame.</figcaption>
    </figure>
  );
}

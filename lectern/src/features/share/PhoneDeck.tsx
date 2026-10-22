// A shared deck on a phone. The presenter's phone gets a teleprompter and remote;
// everyone else follows the slides, answers polls and can keep the deck.

import {
  AArrowDown, AArrowUp, ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Download, EyeOff, LoaderCircle, Maximize, Radio, ScrollText, WifiOff, X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Deck, Slide } from '../../core/deck/types';
import { deckPurpose } from '../../core/deck/types';
import { wording } from '../../core/deck/purpose';
import { getKind } from '../../core/kinds/registry';
import { slideCreditLines, slidePictures } from '../../core/pictures/credits';
import {
  type CloudResult, type LiveState, type PollResult, type Role, type ShareOptions, cleanWord, cloudLimit, pollChoices, withLiveWords,
} from '../../core/share/protocol';
import { useKeys } from '../../ui/hooks';
import { pictureCredits } from '../pictures/store';
import { advance, retreat, useLiveDeck } from '../present/useLiveDeck';
import { SlideView } from '../slides/SlideView';
import { exportPptx } from '../studio/download';
import { type LinkSnapshot, liveLink, useLiveLink } from './guest';
import { NameCard, QuizCard, QuizPresenter, QuizStandings, ScoreChip } from './QuizPhone';
import { quizItem } from '../../core/share/quiz';

const START: LiveState = { index: 0, step: 0, blank: false, flags: {}, startedAt: null };

function heading(slide: Slide | undefined) {
  if (!slide) return '';
  const def = getKind(slide.kind);
  return def ? def.heading(slide.content) : slide.kind;
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** The credit lines for the pictures on a slide, from this phone's copy of them. */
function useSlideCredits(slide: Slide | undefined): string[] {
  const refs = slide ? slidePictures(slide) : [];
  const credits = useLiveQuery(() => pictureCredits(refs), [refs.join('|')]);
  return useMemo(() => (slide && credits ? slideCreditLines(slide, credits) : []), [slide, credits]);
}

/** Keeps the phone's screen on while presenting. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const take = () => { navigator.wakeLock.request('screen').then((l) => { if (gone) void l.release(); else lock = l; }).catch(() => {}); };
    take();
    const onVisible = () => { if (document.visibilityState === 'visible') take(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { gone = true; document.removeEventListener('visibilitychange', onVisible); void lock?.release(); };
  }, [active]);
}

/** Left and right swipes on an element. */
function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) (dx < 0 ? onLeft : onRight)();
    },
  };
}

function LinkStatus({ link, live }: { link: LinkSnapshot; live: boolean }) {
  if (link.status === 'ended') return <span className="phone-status is-off"><WifiOff size={13} /> Sharing ended · saved</span>;
  if (!live) return <span className="phone-status is-off"><WifiOff size={13} /> Saved on this phone</span>;
  if (link.status === 'reconnecting') return <span className="phone-status is-wait"><LoaderCircle size={13} className="spin" /> Reconnecting</span>;
  return <span className="phone-status is-live"><span className="live-dot" aria-hidden /> Live</span>;
}

function PollBars({ choices, result, mine }: { choices: string[]; result?: PollResult; mine?: number }) {
  const total = result?.total ?? 0;
  return (
    <ol className="phone-poll-bars">
      {choices.map((c, i) => {
        const n = result?.counts[i] ?? 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <li key={i} className={mine === i ? 'is-mine' : ''}>
            <span className="phone-poll-text"><b>{String.fromCharCode(65 + i)}</b> {c}</span>
            <span className="phone-poll-bar"><span style={{ width: `${pct}%` }} /></span>
            <span className="tabular">{pct}%</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The words a cloud has so far, most common first, as a short list. */
function CloudList({ result }: { result?: CloudResult }) {
  const top = result?.words.slice(0, 8) ?? [];
  if (!top.length) return <p className="faint">No answers yet.</p>;
  return (
    <ol className="phone-word-top">
      {top.map((w) => <li key={w.text}><span>{w.text}</span><span className="tabular">{w.count}</span></li>)}
    </ol>
  );
}

/** Where someone in the room types their answers to a word cloud. */
function WordCard({ slide, limit, link }: { slide: Slide; limit: number; link: LinkSnapshot }) {
  const [value, setValue] = useState('');
  const [repeat, setRepeat] = useState(false);
  const mine = link.myWords[slide.id] ?? [];
  const left = limit - mine.length;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (liveLink.sendWord(slide.id, value, limit)) setValue('');
    else setRepeat(!!cleanWord(value));
  };
  const label = left <= 0
    ? (limit === 1 ? 'Your answer is in' : 'Your answers are in')
    : mine.length ? `${left} more if you like` : limit === 1 ? 'Your answer' : `Up to ${limit} answers`;
  return (
    <section className="phone-card phone-words" aria-label="Answer the word cloud">
      <p className="eyebrow">{label}</p>
      {left > 0 && (
        <form className="phone-word-form" onSubmit={submit}>
          <input
            className="input" value={value} onChange={(e) => { setValue(e.target.value); setRepeat(false); }} maxLength={32} placeholder="A word or two"
            aria-label="Your answer" enterKeyHint="send" autoComplete="off" autoCapitalize="off" data-testid="word-input"
          />
          <button type="submit" className="btn btn-brand" disabled={!cleanWord(value)} data-testid="word-send">Send</button>
        </form>
      )}
      {repeat && left > 0 && <p className="faint phone-word-note" role="status">You sent that one already. Try another word.</p>}
      {mine.length > 0 && <ul className="phone-word-mine" aria-label="What you sent">{mine.map((w) => <li key={w} className="chip">{w}</li>)}</ul>}
    </section>
  );
}

// ─── The presenter's phone ────────────────────────────────────────────

function PhoneRemote({ deck, slides, steps, live, link, onLeave }: PhoneProps) {
  const navigate = useNavigate();
  const [local, setLocal] = useState<LiveState>(START);
  const state = live && link.state ? link.state : local;
  const setState = (next: LiveState) => { if (live) liveLink.setState(next); else setLocal(next); };
  // When sharing ends, carry on from where the show was.
  useEffect(() => { if (!live && link.state) setLocal(link.state); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem('lectern.phone.size')) || 22; } catch { return 22; } });
  const [now, setNow] = useState(Date.now());
  useWakeLock(true);
  useEffect(() => { try { localStorage.setItem('lectern.phone.size', String(size)); } catch { /* private mode */ } }, [size]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);

  const count = slides.length;
  const index = Math.min(state.index, Math.max(0, count - 1));
  const slide = slides[index];
  const nextSlide = slides[index + 1];
  const next = () => setState({ ...state, ...advance({ index, step: state.step }, steps, count), blank: false, startedAt: state.startedAt ?? Date.now() });
  const prev = () => setState({ ...state, ...retreat({ index, step: state.step }, steps), blank: false });
  const swipe = useSwipe(next, prev);
  const scriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scriptRef.current?.scrollTo({ top: 0 }); }, [index]);

  useKeys((e) => {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
  }, [state, index, steps, count]);

  if (!slide) return null;
  const n = slide.notes;
  const w = wording(deckPurpose(deck));
  const choices = pollChoices(slide);
  const scored = !!link.quiz?.on && link.quiz.question?.slideId === slide.id;
  const remaining = (steps[index] ?? 0) - state.step;

  return (
    <div className="phone phone-remote">
      <header className="phone-bar">
        <button type="button" className="phone-icon" onClick={onLeave} aria-label="Leave"><ArrowLeft size={20} /></button>
        <button type="button" className="phone-timer tabular" onClick={() => setState({ ...state, startedAt: Date.now() })} aria-label={state.startedAt ? 'Restart timer' : 'Start timer'}>
          {state.startedAt ? clock(now - state.startedAt) : 'Start timer'}
        </button>
        <span className="phone-count tabular">{index + 1} / {count}</span>
        <LinkStatus link={link} live={live} />
      </header>

      <div className="phone-stage" {...swipe}>
        <SlideView slide={live ? withLiveWords(slide, link.clouds[slide.id]) : slide} deck={deck} number={index + 1} count={count} step={state.step} ghostLater flags={state.flags} framed label={`Slide ${index + 1} of ${count}`} />
        {state.blank && <div className="phone-blank"><EyeOff size={18} /> The screen is blank</div>}
        {remaining > 0 && <span className="phone-steps">{remaining} more {remaining === 1 ? 'click' : 'clicks'}</span>}
      </div>

      <div className="phone-script" ref={scriptRef} style={{ fontSize: size }}>
        {n.cues.length > 0 && <div className="cue-row">{n.cues.map((c) => <span key={c} className="cue">{c}</span>)}</div>}
        {n.script
          ? n.script.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)
          : n.keyPoints.length ? <ul>{n.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p className="faint">No script for this slide.</p>}
        {n.script && n.keyPoints.length > 0 && (
          <div className="phone-block"><span className="eyebrow">{w.rememberEyebrow}</span><ul>{n.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
        )}
        {n.check && <div className="phone-block"><span className="eyebrow">{w.askEyebrow}</span><p>{n.check.question}</p>{n.check.answer && <p className="faint">{n.check.answer}</p>}</div>}
        {choices && live && !scored && (
          <div className="phone-block">
            <span className="eyebrow">Answers so far · {link.votes[slide.id]?.total ?? 0}</span>
            <PollBars choices={choices} result={link.votes[slide.id]} />
          </div>
        )}
        {live && cloudLimit(slide) !== null && (
          <div className="phone-block">
            <span className="eyebrow">Words so far · {link.clouds[slide.id]?.people ?? 0} {link.clouds[slide.id]?.people === 1 ? 'person' : 'people'}</span>
            <CloudList result={link.clouds[slide.id]} />
          </div>
        )}
        {live && <QuizPresenter link={link} choices={scored ? choices : null} />}
      </div>

      <div className="phone-tools">
        <span className="phone-next-label">{nextSlide ? <>Next: <strong>{heading(nextSlide)}</strong></> : 'Last slide'}</span>
        <button type="button" className="phone-icon" onClick={() => setSize((s) => Math.max(14, s - 2))} aria-label="Smaller text"><AArrowDown size={18} /></button>
        <button type="button" className="phone-icon" onClick={() => setSize((s) => Math.min(40, s + 2))} aria-label="Larger text"><AArrowUp size={18} /></button>
        <button type="button" className="phone-icon" aria-pressed={state.blank} onClick={() => setState({ ...state, blank: !state.blank })} aria-label="Blank the screen"><EyeOff size={18} /></button>
        <button type="button" className="phone-icon" onClick={() => navigate(`/prompter/${deck.id}`)} aria-label="Scrolling teleprompter"><ScrollText size={18} /></button>
      </div>

      <footer className="phone-controls">
        <button type="button" className="phone-back" onClick={prev} disabled={index === 0 && state.step === 0} aria-label="Back"><ChevronLeft size={26} /></button>
        <button type="button" className="phone-next" onClick={next} disabled={index === count - 1 && remaining <= 0}>
          {remaining > 0 ? 'Next click' : 'Next slide'} <ChevronRight size={24} />
        </button>
      </footer>
    </div>
  );
}

// ─── Everyone else ────────────────────────────────────────────────────

function PhoneFollow({ deck, slides, live, link, options, onLeave }: PhoneProps) {
  const navigate = useNavigate();
  const [browse, setBrowse] = useState<number | null>(null);
  const [files, setFiles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [askedName, setAskedName] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const following = live && link.status !== 'ended' && browse === null && !!link.state;
  const count = slides.length;
  const liveIndex = link.state ? Math.min(link.state.index, count - 1) : 0;
  const index = following ? liveIndex : Math.min(browse ?? liveIndex, count - 1);
  const slide = slides[index];
  const step = following ? link.state!.step : undefined;
  const go = (i: number) => { setBrowse(Math.max(0, Math.min(count - 1, i))); setReveal(false); };
  const swipe = useSwipe(() => go(index + 1), () => go(index - 1));
  useEffect(() => { setReveal(false); }, [index]);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [index]);

  useKeys((e) => {
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
  }, [index, count]);
  const creditLines = useSlideCredits(slide);

  if (!slide) return null;
  const question = live ? link.quiz?.question : null;
  // The live question, when this phone is showing it.
  const scored = !!question && link.quiz?.on && question.slideId === slide.id;
  // Past quiz questions aren't polls.
  const pastQuestion = !scored && !!link.quiz?.on && !!quizItem(slide);
  const choices = live && (scored || (options.polls && !pastQuestion)) ? pollChoices(slide) : null;
  const wordLimit = live && options.polls && link.status !== 'ended' ? cloudLimit(slide) : null;
  const openElsewhere = !!question && question.phase === 'open' && question.slideId !== slide.id && link.myAnswers[question.slideId] === undefined;
  const wantsName = live && !!link.quiz?.on && (link.quiz?.questions ?? 0) > 0 && !link.name && !askedName;
  const mine = link.myVotes[slide.id];
  const voted = mine !== undefined && changing !== slide.id;
  const n = slide.notes;
  const w = wording(deckPurpose(deck));
  const fullscreen = () => {
    const el = stageRef.current;
    if (!el?.requestFullscreen) return;
    el.requestFullscreen().then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape')).catch(() => {});
  };
  const savePptx = async () => {
    setSaving(true);
    try { await exportPptx(deck); } finally { setSaving(false); }
  };

  return (
    <div className="phone phone-follow">
      <header className="phone-bar">
        <button type="button" className="phone-icon" onClick={onLeave} aria-label="Leave"><ArrowLeft size={20} /></button>
        <strong className="phone-title">{deck.title}</strong>
        <ScoreChip link={link} />
        <LinkStatus link={link} live={live} />
      </header>

      <div className={`phone-stage ${following ? 'is-following' : ''}`} ref={stageRef} {...swipe}>
        <SlideView slide={live ? withLiveWords(slide, link.clouds[slide.id]) : slide} deck={deck} number={index + 1} count={count} step={step} flags={link.state?.flags} label={`Slide ${index + 1} of ${count}`} framed live />
        {following && link.state?.blank && <div className="phone-blank">The presenter paused the slides</div>}
        <button type="button" className="phone-full" onClick={fullscreen} aria-label="Full screen"><Maximize size={16} /></button>
      </div>

      <div className="phone-follow-bar">
        <button type="button" className="phone-icon" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide"><ChevronLeft size={22} /></button>
        {live && link.state && link.status !== 'ended' && !following
          ? <button type="button" className="btn btn-brand btn-sm" onClick={() => setBrowse(null)}><Radio size={15} /> Back to live · slide {liveIndex + 1}</button>
          : <span className="phone-count tabular">{index + 1} / {count}</span>}
        <button type="button" className="phone-icon" onClick={() => go(index + 1)} disabled={index === count - 1} aria-label="Next slide"><ChevronRight size={22} /></button>
      </div>

      <div className="phone-body">
        {openElsewhere && (
          <button type="button" className="quiz-jump" onClick={() => setBrowse(null)}>A question is open · Answer now</button>
        )}
        <QuizStandings link={link} />
        {wantsName && <NameCard onDone={() => setAskedName(true)} />}
        {scored && choices && <QuizCard link={link} choices={choices} />}
        {!scored && choices && (
          <section className="phone-card phone-poll" aria-label="Answer the question">
            <p className="eyebrow">{voted ? 'Your answer is in' : 'Tap your answer'}</p>
            {voted
              ? <PollBars choices={choices} result={link.votes[slide.id]} mine={mine} />
              : (
                <div className="phone-choices">
                  {choices.map((c, i) => (
                    <button key={i} type="button" aria-pressed={mine === i} onClick={() => { liveLink.vote(slide.id, i); setChanging(null); }}><b>{String.fromCharCode(65 + i)}</b><span>{c}</span></button>
                  ))}
                </div>
              )}
            {voted && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChanging(slide.id)}>Change my answer</button>}
          </section>
        )}

        {wordLimit !== null && <WordCard slide={slide} limit={wordLimit} link={link} />}

        {options.shareTakeaways && n.keyPoints.length > 0 && (
          <section className="phone-card">
            <p className="eyebrow">{w.rememberEyebrow}</p>
            <ul>{n.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </section>
        )}
        {options.shareTakeaways && n.check && (
          <section className="phone-card">
            <p className="eyebrow">Check yourself</p>
            <p>{n.check.question}</p>
            {reveal ? <p className="muted">{n.check.answer}</p> : n.check.answer && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReveal(true)}>Show the answer</button>}
          </section>
        )}

        {creditLines.length > 0 && (
          <p className="phone-credit faint">{creditLines.length === 1 ? 'Picture credit' : 'Picture credits'}: {creditLines.join('; ')}</p>
        )}

        <button type="button" className="phone-files-btn" onClick={() => setFiles(true)}>
          <Download size={18} /> <span><strong>Keep these slides</strong><span className="muted">{options.allowDownload ? 'PowerPoint, or review them later in Lectern' : 'Review them later in Lectern'}</span></span>
        </button>
      </div>

      <nav className="phone-strip" ref={stripRef} aria-label="All slides">
        {slides.map((s, i) => (
          <button key={s.id} type="button" data-i={i} className={`${i === index ? 'is-current' : ''} ${live && link.state && i === liveIndex ? 'is-live' : ''}`} onClick={() => go(i)} aria-label={`Slide ${i + 1}`}>
            <SlideView slide={s} deck={deck} number={i + 1} count={count} framed />
          </button>
        ))}
      </nav>

      {files && (
        <div className="phone-sheet" role="dialog" aria-modal="true" aria-labelledby="phone-sheet-title" onClick={(e) => { if (e.target === e.currentTarget) setFiles(false); }}>
          <div className="phone-sheet-card">
            <div className="phone-sheet-head">
              <h2 id="phone-sheet-title">Keep these slides</h2>
              <button type="button" className="phone-icon" onClick={() => setFiles(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <p className="muted">They’re already saved on this phone, so they work without a connection.</p>
            {options.allowDownload && (
              <button type="button" className="phone-sheet-row" onClick={savePptx} disabled={saving}>
                {saving ? <LoaderCircle size={20} className="spin" /> : <Download size={20} />}
                <span><strong>PowerPoint</strong><span className="muted">Opens in PowerPoint, Keynote or Google Slides</span></span>
              </button>
            )}
            <button type="button" className="phone-sheet-row" onClick={() => navigate(`/study/${deck.id}`)}>
              <BookOpen size={20} />
              <span><strong>{w.studyName}</strong><span className="muted">Go through the slides at your own pace</span></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface PhoneProps {
  deck: Deck;
  slides: Slide[];
  steps: number[];
  live: boolean;
  link: LinkSnapshot;
  options: ShareOptions;
  onLeave(): void;
}

/** A shared deck on this phone, live when the link is connected to it. */
export function PhoneDeck({ deckId, role, options, onLeave }: { deckId: string; role: Role; options?: ShareOptions | null; onLeave(): void }) {
  const link = useLiveLink();
  const { deck, slides, steps } = useLiveDeck(deckId);
  const live = link.deckId === deckId && ['ready', 'reconnecting', 'receiving'].includes(link.status);
  const opts = useMemo<ShareOptions>(() => link.options ?? options ?? { allowDownload: false, shareTakeaways: false, polls: false }, [link.options, options]);

  if (deck === undefined) return <div className="phone phone-loading"><LoaderCircle className="spin" /></div>;
  if (deck === null || !slides.length) {
    return (
      <div className="phone phone-message">
        <h1>These slides aren’t on this phone</h1>
        <button type="button" className="btn btn-primary" onClick={onLeave}>Join with a code</button>
      </div>
    );
  }
  const props: PhoneProps = { deck, slides, steps, live, link, options: opts, onLeave };
  return role === 'presenter' ? <PhoneRemote {...props} /> : <PhoneFollow {...props} />;
}

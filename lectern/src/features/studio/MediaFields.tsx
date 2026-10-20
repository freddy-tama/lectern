import { Clapperboard, Code2, PenTool, RotateCcw, Sparkles, Trash2, Upload, Wand2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FieldSpec } from '../../core/kinds/types';
import { ACTIVITY_MAX, cleanSvg, extractHtml, looksLikeHtml } from '../../core/media/embed';
import { parseVideo, videoLabel, videoThumbnail } from '../../core/media/video';
import { db } from '../../data/db';
import { saveAsset } from '../../data/repo';
import { usePictureContext } from '../pictures/context';
import { savePicture } from '../pictures/store';
import { useToast } from '../../ui/Toast';
import { CodeAiError, codeAiStatus, makeActivity, makeDrawing, sizedSvg } from './code-ai';

type Content = Record<string, unknown>;

/** Largest video file kept in the browser. */
const VIDEO_MAX = 300 * 1024 * 1024;

function useCodeAi() {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    codeAiStatus().then((s) => alive && setReady(s.available));
    return () => { alive = false; };
  }, []);
  return ready;
}

/** Seconds since a job started, for "Building… 40 s". */
function useElapsed(running: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) { setS(0); return; }
    const t0 = Date.now();
    const id = window.setInterval(() => setS(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return s;
}

function sizeLabel(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes > 20 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ─── Video ────────────────────────────────────────────────────────────

/** A video link or an uploaded file. */
export function VideoField({ spec, value, onChange, bind }: { spec: Extract<FieldSpec, { type: 'video' }>; value: string; onChange(v: string): void; bind: string }) {
  const [draft, setDraft] = useState(value.startsWith('asset:') ? '' : value);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const source = parseVideo(value);
  const thumb = videoThumbnail(source);

  useEffect(() => { if (!value.startsWith('asset:')) setDraft(value); }, [value]);
  useEffect(() => {
    let alive = true;
    if (!value.startsWith('asset:')) { setFile(null); return; }
    db.assets.get(value.slice(6)).then((a) => alive && setFile(a ? { name: a.name, size: a.blob.size } : null));
    return () => { alive = false; };
  }, [value]);

  const commit = (link: string) => {
    const v = link.trim();
    if (!v) { onChange(''); setError(''); return; }
    if (!parseVideo(v)) { setError('Lectern can’t play this link. Use a YouTube or Vimeo link, a link that ends in .mp4 or .webm, or upload a file.'); return; }
    setError('');
    onChange(v);
  };

  const take = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (!f.type.startsWith('video/')) { setError('Choose a video file: MP4, WebM or MOV.'); return; }
    if (f.size > VIDEO_MAX) { setError(`This video is ${sizeLabel(f.size)}. Choose one under ${sizeLabel(VIDEO_MAX)}, or upload it to YouTube and paste the link.`); return; }
    setBusy(true);
    try {
      onChange(await saveAsset(f, f.name));
    } catch (e) {
      setError(`The video couldn’t be saved in this browser. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field video-field" data-bind={bind} tabIndex={-1}>
      <span className="field-label">{spec.label}</span>
      <div
        className={`video-drop ${source ? 'has-video' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          const link = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
          if (f) void take(f);
          else if (link) { setDraft(link.trim()); commit(link); }
        }}
      >
        {thumb ? <img src={thumb} alt="" /> : <Clapperboard size={26} aria-hidden />}
        <span className="video-drop-label">
          {source ? (file ? `${file.name} · ${sizeLabel(file.size)}` : videoLabel(source)) : 'Paste a link or drop a video file'}
          {source?.provider !== 'file' && source?.start ? ` · from ${Math.floor(source.start / 60)}:${String(source.start % 60).padStart(2, '0')}` : ''}
        </span>
        {busy && <span className="image-busy"><span className="spinner" /></span>}
      </div>
      <div className="link-row">
        <input
          className="input"
          value={draft}
          placeholder="YouTube, Vimeo or video link"
          aria-label="Video link"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft.trim() !== (value.startsWith('asset:') ? '' : value)) commit(draft); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(draft); } }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').trim();
            if (parseVideo(pasted)) { e.preventDefault(); setDraft(pasted); commit(pasted); }
          }}
        />
      </div>
      <div className="image-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={busy}><Upload size={14} /> Upload a file</button>
        {value && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => { onChange(''); setDraft(''); }}><Trash2 size={14} /> Remove</button>}
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {error ? <span className="field-help field-error" role="alert">{error}</span> : spec.help && <span className="field-help">{spec.help}</span>}
    </div>
  );
}

// ─── Activity ─────────────────────────────────────────────────────────

const STARTERS = [
  { label: 'Quiz game', prompt: 'A quiz game with five multiple-choice questions about this topic, big answer buttons, a score and a play-again button' },
  { label: 'Sorting', prompt: 'A drag-and-drop sorting game: sort eight cards into two or three groups, with a check button that shows what is right' },
  { label: 'Flashcards', prompt: 'Flashcards that flip on click or tap, with next and previous buttons and a shuffle button' },
  { label: 'Simulation', prompt: 'An interactive simulation with sliders that change the inputs and a live animated picture of what happens' },
  { label: 'Memory match', prompt: 'A memory matching game with twelve cards in pairs, a move counter and a restart button' },
];

/** What to build, AI to build or change it, and the code itself for a paste or a tweak. */
export function ActivityField({ spec, content, onChange, bind }: { spec: Extract<FieldSpec, { type: 'activity' }>; content: Content; onChange(key: string, value: unknown): void; bind: string }) {
  const context = usePictureContext();
  const toast = useToast();
  const ai = useCodeAi();
  const prompt = typeof content[spec.key] === 'string' ? (content[spec.key] as string) : '';
  const html = typeof content[spec.htmlKey] === 'string' ? (content[spec.htmlKey] as string) : '';
  const [busy, setBusy] = useState<'' | 'build' | 'change'>('');
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [change, setChange] = useState('');
  const [code, setCode] = useState(false);
  const [draftCode, setDraftCode] = useState(html);
  const job = useRef<AbortController | null>(null);
  const elapsed = useElapsed(Boolean(busy));

  useEffect(() => { setDraftCode(html); }, [html]);
  useEffect(() => () => job.current?.abort(), []);

  const info = {
    deckTitle: context?.deckTitle ?? '', audience: context?.audience ?? 'adult', purpose: context?.purpose ?? 'talk', theme: context?.theme,
  } as const;

  const run = async (mode: 'build' | 'change') => {
    setError('');
    setBusy(mode);
    const controller = new AbortController();
    job.current = controller;
    try {
      const before = html;
      const result = await makeActivity(info, {
        prompt, title: typeof content.title === 'string' ? content.title : '', current: html, change: mode === 'change' ? change : undefined,
      }, controller.signal);
      onChange(spec.htmlKey, result.html);
      if (result.instructions && 'caption' in content && !String(content.caption ?? '').trim()) onChange('caption', result.instructions);
      setChanging(false);
      setChange('');
      toast.show(mode === 'build' ? 'Activity built. Try it on the slide.' : 'Activity changed', before ? { action: { label: 'Undo', run: () => onChange(spec.htmlKey, before) } } : undefined);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof CodeAiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy('');
      job.current = null;
    }
  };

  const useCode = () => {
    const value = extractHtml(draftCode);
    if (value && !looksLikeHtml(value)) { setError('That doesn’t look like HTML. Paste a whole page, from <!doctype html> to </html>.'); return; }
    if (value.length > ACTIVITY_MAX) { setError(`That’s ${sizeLabel(value.length)}. Activities can be up to ${sizeLabel(ACTIVITY_MAX)}.`); return; }
    setError('');
    onChange(spec.htmlKey, value);
  };

  return (
    <div className="field activity-field" data-bind={bind} tabIndex={-1}>
      <span className="field-label">{spec.label}</span>
      <textarea
        className="textarea"
        rows={3}
        data-bind={bind}
        value={prompt}
        placeholder={spec.placeholder}
        aria-label={spec.label}
        onChange={(e) => onChange(spec.key, e.target.value)}
      />
      {!prompt.trim() && !html && (
        <div className="starter-chips" aria-label="Ideas">
          {STARTERS.map((s) => <button key={s.label} type="button" className="chip chip-btn" onClick={() => onChange(spec.key, s.prompt)}>{s.label}</button>)}
        </div>
      )}
      {busy ? (
        <div className="activity-busy" role="status">
          <span className="spinner" /> {busy === 'build' ? 'Building' : 'Changing'} the activity… {elapsed > 2 ? `${elapsed} s` : ''}
          <span className="faint">This usually takes a minute or two.</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => job.current?.abort()}>Cancel</button>
        </div>
      ) : (
        <div className="image-actions">
          {ai !== false && (
            <button type="button" className="btn btn-primary btn-sm" disabled={!prompt.trim() || ai === null} onClick={() => run('build')}>
              {html ? <RotateCcw size={14} /> : <Sparkles size={14} />} {html ? 'Build again' : 'Build it'}
            </button>
          )}
          {html && ai !== false && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChanging((v) => !v)}><Wand2 size={14} /> Change…</button>}
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={code} onClick={() => setCode((v) => !v)}><Code2 size={14} /> {html ? 'Code' : 'Paste code'}</button>
          {html && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => onChange(spec.htmlKey, '')}><Trash2 size={14} /> Remove</button>}
        </div>
      )}
      {changing && !busy && (
        <div className="link-row">
          <input
            className="input"
            autoFocus
            value={change}
            placeholder="Bigger buttons, add a timer, ten questions…"
            aria-label="What to change"
            onChange={(e) => setChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && change.trim()) { e.preventDefault(); void run('change'); } if (e.key === 'Escape') setChanging(false); }}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={!change.trim()} onClick={() => run('change')}>Apply</button>
        </div>
      )}
      {code && (
        <div className="code-box">
          <textarea
            className="textarea code-textarea"
            rows={8}
            spellCheck={false}
            value={draftCode}
            placeholder="<!doctype html> … </html>"
            aria-label="Activity code"
            onChange={(e) => setDraftCode(e.target.value)}
          />
          <div className="image-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={draftCode === html} onClick={useCode}>Use this code</button>
            {html && <span className="faint">{sizeLabel(html.length)}</span>}
          </div>
        </div>
      )}
      {error && <span className="field-help field-error" role="alert">{error}</span>}
      <span className="field-help">
        {ai === false
          ? 'AI isn’t set up on this server. Paste a complete HTML page instead.'
          : 'Runs on the slide in a sealed frame with no internet access. People who join with Share can play it on their phones.'}
      </span>
    </div>
  );
}

// ─── Drawing (SVG) ────────────────────────────────────────────────────

const ASPECT = { square: 1, tall: 0.75, wide: 1.6 } as const;

/** Draw a picture for an image field: AI writes an SVG, or paste SVG code. */
export function DrawPanel({ shape, suggestion, onDone, onClose }: {
  shape: keyof typeof ASPECT; suggestion: string; onDone(ref: string, note?: string): void; onClose(): void;
}) {
  const context = usePictureContext();
  const ai = useCodeAi();
  const [mode, setMode] = useState<'ai' | 'paste'>('ai');
  const [prompt, setPrompt] = useState(suggestion ? `A clear, labelled illustration of ${suggestion}` : '');
  const [svg, setSvg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const job = useRef<AbortController | null>(null);
  const elapsed = useElapsed(busy);
  useEffect(() => { if (ai === false) setMode('paste'); }, [ai]);
  useEffect(() => () => job.current?.abort(), []);

  const save = async (markup: string, how: 'ai' | 'paste', alt = '') => {
    const blob = new Blob([sizedSvg(markup)], { type: 'image/svg+xml' });
    const ref = await savePicture(blob, alt || prompt || 'Drawing', how === 'ai'
      ? { source: 'ai', rights: 'ai', query: prompt, title: alt || undefined, model: 'Claude' }
      : { source: 'upload', rights: 'own', title: 'Drawing' });
    onDone(ref, how === 'ai' ? 'Drawing added. It stays sharp at any size.' : undefined);
  };

  const draw = async () => {
    setError('');
    setBusy(true);
    const controller = new AbortController();
    job.current = controller;
    try {
      const out = await makeDrawing({
        deckTitle: context?.deckTitle ?? '', audience: context?.audience ?? 'adult', purpose: context?.purpose ?? 'talk', theme: context?.theme,
      }, { prompt, aspect: ASPECT[shape], title: context?.heading }, controller.signal);
      await save(out.svg, 'ai', out.alt);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof CodeAiError ? e.message : (e as Error).message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
      job.current = null;
    }
  };

  const paste = async () => {
    const clean = cleanSvg(svg);
    if (!clean) { setError('That isn’t SVG code. Paste everything from <svg to </svg>.'); return; }
    setError('');
    try {
      await save(clean, 'paste');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="draw-panel">
      <div className="draw-panel-head">
        <div className="segmented" role="group" aria-label="How to draw">
          <button type="button" aria-pressed={mode === 'ai'} disabled={ai === false} onClick={() => setMode('ai')}>Draw with AI</button>
          <button type="button" aria-pressed={mode === 'paste'} onClick={() => setMode('paste')}>Paste SVG</button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={15} /></button>
      </div>
      {mode === 'ai' ? (
        <>
          <textarea className="textarea" rows={3} autoFocus value={prompt} placeholder="A labelled diagram of the water cycle" aria-label="Describe the drawing" onChange={(e) => setPrompt(e.target.value)} />
          {busy ? (
            <div className="activity-busy" role="status">
              <span className="spinner" /> Drawing… {elapsed > 2 ? `${elapsed} s` : ''}
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => job.current?.abort()}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" disabled={!prompt.trim() || ai === null} onClick={draw}><PenTool size={14} /> Draw it</button>
          )}
        </>
      ) : (
        <>
          <textarea className="textarea code-textarea" rows={6} autoFocus spellCheck={false} value={svg} placeholder="<svg viewBox=&quot;0 0 800 450&quot;> … </svg>" aria-label="SVG code" onChange={(e) => setSvg(e.target.value)} />
          <button type="button" className="btn btn-primary btn-sm" disabled={!svg.trim()} onClick={paste}>Use this SVG</button>
        </>
      )}
      {error && <span className="field-help field-error" role="alert">{error}</span>}
    </div>
  );
}

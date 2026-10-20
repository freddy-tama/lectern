import { ExternalLink, ImagePlus, Link2, Search, Sparkles, Star, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type PictureCredit, type PictureRights, RIGHTS_LABEL, licenseLimits, rightsOf } from '../../core/pictures/credits';
import { type FoundPicture, type PictureShape, type RankedPicture, rankPictures } from '../../core/pictures/rank';
import { assetUrl } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { saveCode, savedCode } from '../studio/ai';
import {
  type GenerateStatus, NoServerError, PROVIDER_LABEL, type PictureProvider, type PictureStyle,
  downloadPicture, generatePicture, pictureGenerateStatus, pictureProviders, searchLibrary,
} from './api';
import type { PictureSlideContext } from './context';
import { dismissResult, dismissedFor, savePicture, starredFor, undismissResult, usePictureMemory } from './store';
import '../../styles/pictures.css';

type Tab = 'search' | 'link' | 'upload' | 'generate';
type LicenceFilter = 'any' | 'free' | 'commercial';

export interface PictureFinderProps {
  open: boolean;
  onClose(): void;
  /** The stored picture ("asset:<id>", or a plain link when nothing could be downloaded), with a note to show. */
  onPick(ref: string, note?: string): void;
  query: string;
  /** Other searches worth a try, such as the deck's subject. */
  suggestions?: string[];
  shape: PictureShape;
  context: PictureSlideContext | null;
}

const SHAPES: { id: PictureShape; label: string }[] = [
  { id: 'wide', label: 'Wide' },
  { id: 'square', label: 'Square' },
  { id: 'tall', label: 'Tall' },
];

const RIGHTS_SHORT: Record<PictureRights, string> = { free: 'Free to use', credit: 'Credit', limited: 'Credit, limits', unclear: 'Rights unknown', own: 'Yours', ai: 'AI' };

const MAX_UPLOAD = 12 * 1024 * 1024;

export function PictureFinder(props: PictureFinderProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Find a picture" wide className="picture-finder">
      {props.open && <FinderBody {...props} />}
    </Dialog>
  );
}

function FinderBody({ onPick, query, suggestions = [], shape: initialShape, context }: PictureFinderProps) {
  const [providers, setProviders] = useState<PictureProvider[] | null>(null);
  const [generate, setGenerate] = useState<GenerateStatus | null>(null);
  const [tab, setTab] = useState<Tab>('search');
  const [shape, setShape] = useState<PictureShape>(initialShape);

  useEffect(() => {
    let alive = true;
    pictureProviders().then((p) => {
      if (!alive) return;
      setProviders(p);
      if (!p.length) setTab((t) => (t === 'search' ? 'upload' : t));
    });
    pictureGenerateStatus().then((s) => alive && setGenerate(s));
    return () => { alive = false; };
  }, []);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'search', label: 'Search', icon: <Search size={14} /> },
    { id: 'link', label: 'Link', icon: <Link2 size={14} /> },
    { id: 'upload', label: 'Upload', icon: <Upload size={14} /> },
    ...(generate?.available ? [{ id: 'generate' as const, label: 'Make with AI', icon: <Sparkles size={14} /> }] : []),
  ];

  return (
    <div className="pf">
      <div className="pf-bar">
        <div className="segmented pf-tabs" role="tablist" aria-label="Where the picture comes from">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`pf-tab-${t.id}`} aria-controls={`pf-panel-${t.id}`} aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const i = tabs.findIndex((x) => x.id === tab);
                const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                setTab(next.id);
                document.getElementById(`pf-tab-${next.id}`)?.focus();
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        {(tab === 'search' || tab === 'generate') && (
          <div className="segmented pf-shape" role="group" aria-label="Shape of the frame">
            {SHAPES.map((s) => <button key={s.id} type="button" aria-pressed={shape === s.id} onClick={() => setShape(s.id)}>{s.label}</button>)}
          </div>
        )}
      </div>
      <div role="tabpanel" id={`pf-panel-${tab}`} aria-labelledby={`pf-tab-${tab}`} className="pf-panel">
        {tab === 'search' && <SearchPanel providers={providers} query={query} suggestions={suggestions} shape={shape} context={context} onPick={onPick} onSwitch={setTab} canGenerate={Boolean(generate?.available)} />}
        {tab === 'link' && <LinkPanel onPick={onPick} />}
        {tab === 'upload' && <UploadPanel onPick={onPick} noServer={providers !== null && !providers.length} />}
        {tab === 'generate' && generate?.available && <GeneratePanel status={generate} shape={shape} context={context} onPick={onPick} />}
      </div>
    </div>
  );
}

// ─── Search ───────────────────────────────────────────────────────────

function SearchPanel({ providers, query, suggestions, shape, context, onPick, onSwitch, canGenerate }: {
  providers: PictureProvider[] | null; query: string; suggestions: string[]; shape: PictureShape; context: PictureSlideContext | null;
  onPick: PictureFinderProps['onPick']; onSwitch(tab: Tab): void; canGenerate: boolean;
}) {
  const [q, setQ] = useState(query);
  const [submitted, setSubmitted] = useState('');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<FoundPicture[]>([]);
  const [pending, setPending] = useState<PictureProvider[]>([]);
  const [errors, setErrors] = useState<Partial<Record<PictureProvider, string>>>({});
  const [filter, setFilter] = useState<LicenceFilter>(context?.purpose === 'pitch' || context?.purpose === 'report' ? 'commercial' : 'any');
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<RankedPicture | null>(null);
  const memory = usePictureMemory();
  const controller = useRef<AbortController | null>(null);

  const run = async (text: string, nextPage = 1) => {
    const list = providers ?? [];
    const words = text.trim();
    if (!list.length || words.length < 2) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setSubmitted(words);
    setPage(nextPage);
    setError('');
    setHidden(null);
    if (nextPage === 1) setResults([]);
    setErrors({});
    setPending(list);
    await Promise.all(list.map(async (p) => {
      try {
        const found = await searchLibrary(p, words, nextPage, shape, c.signal);
        if (!c.signal.aborted) setResults((prev) => [...prev, ...found]);
      } catch (e) {
        if (!c.signal.aborted) setErrors((prev) => ({ ...prev, [p]: (e as Error).message }));
      } finally {
        if (!c.signal.aborted) setPending((prev) => prev.filter((x) => x !== p));
      }
    }));
  };

  // Search for the slide's heading as soon as the libraries are known.
  useEffect(() => {
    if (providers?.length && query.trim().length >= 2) void run(query);
    return () => controller.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  const dismissed = useMemo(() => dismissedFor(memory, submitted), [memory, submitted]);
  const ranked = useMemo(() => rankPictures(results, submitted, { shape, dismissed })
    .filter((p) => !broken.has(p.id))
    .filter((p) => filter === 'any' || (filter === 'free' ? p.rights === 'free' : p.rights === 'free' || p.rights === 'credit')), [results, submitted, shape, dismissed, broken, filter]);
  const starred = useMemo(() => starredFor(memory, submitted || q).slice(0, 8), [memory, submitted, q]);

  if (providers === null) return <div className="pf-empty"><span className="spinner" /></div>;
  if (!providers.length) {
    return (
      <div className="pf-empty">
        <p>Picture search needs Lectern’s server, and this copy doesn’t have one.</p>
        <p className="muted">Upload a picture, or paste a link to one.</p>
        <div className="pf-empty-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSwitch('upload')}><Upload size={14} /> Upload</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSwitch('link')}><Link2 size={14} /> Paste a link</button>
        </div>
      </div>
    );
  }

  const pick = async (p: RankedPicture) => {
    if (saving) return;
    setSaving(p.id);
    setError('');
    try {
      const { blob, url } = await downloadPicture(p.url);
      const ref = await savePicture(blob, p.title || 'Picture', {
        source: p.provider, rights: p.rights, title: p.title, author: p.author, license: p.license, licenseUrl: p.licenseUrl,
        page: p.page, url, query: submitted, resultId: p.id,
      });
      onPick(ref);
    } catch (e) {
      setError(`That picture couldn’t be saved. ${(e as Error).message}`);
    } finally {
      setSaving('');
    }
  };

  const hide = async (p: RankedPicture) => {
    await dismissResult(submitted, p.id);
    setHidden(p);
  };

  const searching = pending.length > 0;
  const tries = [query, ...suggestions].filter((t) => t.toLowerCase() !== submitted.toLowerCase()).slice(0, 3);
  const failed = Object.entries(errors) as [PictureProvider, string][];

  return (
    <div className="pf-search">
      <form className="pf-query" role="search" onSubmit={(e) => { e.preventDefault(); void run(q); }}>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What should the picture show?" aria-label="Search for a picture" autoFocus />
        <button type="submit" className="btn btn-primary btn-sm" disabled={q.trim().length < 2}><Search size={14} /> Search</button>
        <select className="input pf-filter" value={filter} onChange={(e) => setFilter(e.target.value as LicenceFilter)} aria-label="Licence">
          <option value="any">Any licence</option>
          <option value="commercial">OK for commercial use</option>
          <option value="free">No credit needed</option>
        </select>
      </form>

      {starred.length > 0 && (
        <section className="pf-starred" aria-label="Starred pictures">
          <span className="pf-label"><Star size={13} /> Starred</span>
          <div className="pf-starred-row">
            {starred.map((s) => <StarredPick key={s.ref} pictureRef={s.ref} title={s.title} onPick={onPick} />)}
          </div>
        </section>
      )}

      <div className="pf-status" role="status" aria-live="polite">
        {searching ? <><span className="spinner" /> Searching {pending.map((p) => PROVIDER_LABEL[p]).join(' and ')}…</>
          : submitted && !hidden ? <span className="faint">{ranked.length ? `${ranked.length} picture${ranked.length === 1 ? '' : 's'} for “${submitted}”, best first` : ''}</span> : null}
        {hidden && (
          <span className="pf-hidden">
            Hidden. It won’t be suggested for “{submitted}” again.
            <button type="button" className="btn btn-ghost btn-xs" onClick={async () => { await undismissResult(submitted, hidden.id); setHidden(null); }}>Undo</button>
          </span>
        )}
        {failed.map(([p, message]) => <span key={p} className="pf-warn">{message}</span>)}
        {tries.length > 0 && (
          <span className="pf-tries">
            Try
            {tries.map((t) => <button key={t} type="button" className="chip pf-try" onClick={() => { setQ(t); void run(t); }}>{t}</button>)}
          </span>
        )}
      </div>
      {error && <p className="pf-error" role="alert">{error}</p>}

      {ranked.length > 0 ? (
        <ul className="pf-grid">
          {ranked.map((p) => (
            <li key={p.id} className={`pf-tile ${saving === p.id ? 'saving' : ''}`}>
              <button type="button" className="pf-pick" onClick={() => pick(p)} disabled={Boolean(saving)}
                aria-label={`Use “${p.title || 'untitled picture'}”${p.author ? ` by ${p.author}` : ''}, ${RIGHTS_LABEL[p.rights].toLowerCase()}`}>
                <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken((b) => new Set(b).add(p.id))} />
                {saving === p.id && <span className="pf-saving"><span className="spinner" /> Saving…</span>}
              </button>
              <div className="pf-meta">
                <span className={`pf-rights rights-${p.rights}`} title={[p.license, licenseLimits(p.license)].filter(Boolean).join(': ') || 'No licence given'}>{RIGHTS_SHORT[p.rights]}</span>
                <span className="pf-by" title={[p.title, p.author].filter(Boolean).join(' · ')}>{p.author || PROVIDER_LABEL[p.provider]}</span>
                {p.page && <a className="pf-source" href={p.page} target="_blank" rel="noopener noreferrer" aria-label={`Open the source page on ${PROVIDER_LABEL[p.provider]}`} title={`Source: ${PROVIDER_LABEL[p.provider]}`}><ExternalLink size={13} /></a>}
              </div>
              <button type="button" className="pf-dismiss" onClick={() => hide(p)} aria-label="Don’t suggest this picture again" title="Don’t suggest this again"><X size={14} /></button>
            </li>
          ))}
        </ul>
      ) : !searching && submitted ? (
        <div className="pf-empty">
          <p>No pictures found for “{submitted}”{filter !== 'any' ? ' with that licence' : ''}.</p>
          <p className="muted">Try fewer or different words{filter !== 'any' ? ', or allow any licence' : ''}{canGenerate ? ', or make one with AI' : ''}.</p>
          {canGenerate && <div className="pf-empty-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => onSwitch('generate')}><Sparkles size={14} /> Make with AI</button></div>}
        </div>
      ) : searching && !ranked.length ? (
        <ul className="pf-grid" aria-hidden>{Array.from({ length: 8 }, (_, i) => <li key={i} className="pf-tile pf-skeleton" />)}</ul>
      ) : !submitted ? (
        <div className="pf-empty"><p className="muted">Search Openverse{providers.includes('pexels') ? ', Wikimedia Commons and Pexels' : ' and Wikimedia Commons'} for pictures you may reuse. Each one keeps its credit.</p></div>
      ) : null}

      {ranked.length > 0 && !searching && page < 10 && (
        <div className="pf-more"><button type="button" className="btn btn-ghost btn-sm" onClick={() => run(submitted, page + 1)}>More pictures</button></div>
      )}
    </div>
  );
}

/** A starred picture to use again. Pictures deleted since they were starred aren't shown. */
function StarredPick({ pictureRef, title, onPick }: { pictureRef: string; title: string; onPick: PictureFinderProps['onPick'] }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    assetUrl(pictureRef).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [pictureRef]);
  if (url === null) return null;
  return (
    <button type="button" className="pf-starred-pick" onClick={() => onPick(pictureRef)} title={title ? `Use “${title}” again` : 'Use this starred picture again'} aria-label={title ? `Use starred picture “${title}”` : 'Use this starred picture'}>
      {url ? <img src={url} alt="" /> : <span className="pf-thumb-empty" />}
    </button>
  );
}

// ─── Link ─────────────────────────────────────────────────────────────

function CreditInputs({ value, onChange }: { value: Partial<PictureCredit>; onChange(v: Partial<PictureCredit>): void }) {
  return (
    <div className="pf-credit-inputs">
      <label className="field"><span className="field-label">Made by</span><input className="input" value={value.author ?? ''} onChange={(e) => onChange({ ...value, author: e.target.value })} placeholder="Photographer or artist" /></label>
      <label className="field"><span className="field-label">Licence</span><input className="input" value={value.license ?? ''} onChange={(e) => onChange({ ...value, license: e.target.value })} placeholder="For example CC BY 4.0" /></label>
      <label className="field pf-wide-field"><span className="field-label">Source page</span><input className="input" type="url" value={value.page ?? ''} onChange={(e) => onChange({ ...value, page: e.target.value })} placeholder="https://…" /></label>
    </div>
  );
}

function LinkPanel({ onPick }: { onPick: PictureFinderProps['onPick'] }) {
  const [link, setLink] = useState('');
  const [credit, setCredit] = useState<Partial<PictureCredit>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const use = async () => {
    const url = link.trim();
    setError('');
    if (!/^https?:\/\//i.test(url)) { setError('Paste a link that starts with http:// or https://'); return; }
    setBusy(true);
    const license = credit.license?.trim() ?? '';
    const page = /^https?:\/\//i.test(credit.page?.trim() ?? '') ? credit.page!.trim() : '';
    try {
      const { blob, url: final } = await downloadPicture(url);
      const name = decodeURIComponent(new URL(final).pathname.split('/').pop() || 'Picture').replace(/\.[a-z0-9]{2,5}$/i, '');
      onPick(await savePicture(blob, name, { source: 'link', rights: license ? rightsOf(license) : 'unclear', url: final, page, author: credit.author?.trim(), license }));
    } catch (e) {
      // Without a server the link itself is kept, as before the picture finder.
      if (e instanceof NoServerError) onPick(url, 'Saved as a link. It shows only while that site keeps the picture.');
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="pf-form" onSubmit={(e) => { e.preventDefault(); void use(); }}>
      <label className="field">
        <span className="field-label">Picture link</span>
        <input className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/picture.jpg" autoFocus required />
        <span className="field-help">Paste the address of the picture itself. Lectern downloads it and keeps a copy in this deck, so it still shows if the site changes.</span>
      </label>
      <details className="pf-details">
        <summary>Add a credit (optional)</summary>
        <CreditInputs value={credit} onChange={setCredit} />
      </details>
      {error && <p className="pf-error" role="alert">{error}</p>}
      <div className="pf-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !link.trim()}>{busy ? <span className="spinner" /> : <Link2 size={14} />} {busy ? 'Downloading…' : 'Use this picture'}</button>
      </div>
    </form>
  );
}

// ─── Upload ───────────────────────────────────────────────────────────

function UploadPanel({ onPick, noServer }: { onPick: PictureFinderProps['onPick']; noServer: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const take = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose a picture file: JPEG, PNG, WebP, GIF or SVG.'); return; }
    if (file.size > MAX_UPLOAD) { setError('This picture is over 12 MB. Choose a smaller one.'); return; }
    setBusy(true);
    try {
      onPick(await savePicture(file, file.name, { source: 'upload', rights: 'own' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pf-form">
      {noServer && <p className="muted pf-note">Picture search isn’t available on this copy of Lectern.</p>}
      <div
        className={`pf-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files[0]); }}
      >
        <ImagePlus size={26} aria-hidden />
        <p>Drop a picture here</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()} disabled={busy}>{busy ? <span className="spinner" /> : <Upload size={14} />} Choose a picture</button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <p className="field-help">Up to 12 MB. Large photos are made slide-sized. If someone else made it, add their credit under Export → Picture credits.</p>
      {error && <p className="pf-error" role="alert">{error}</p>}
    </div>
  );
}

// ─── Generate ─────────────────────────────────────────────────────────

const STYLES: { id: NonNullable<PictureStyle['kind']>; label: string }[] = [
  { id: 'auto', label: 'Match the look' },
  { id: 'photo', label: 'Photo' },
  { id: 'illustration', label: 'Illustration' },
  { id: 'drawing', label: 'Drawing' },
];

/** A first description from the slide: its heading and a little of its text. */
function describeSlide(context: PictureSlideContext | null): string {
  if (!context) return '';
  const clean = (t: string) => t.trim().replace(/[\s.;:,]+$/, '');
  const extra = context.text.filter((t) => t && t !== context.heading).slice(0, 2).map(clean).filter(Boolean);
  const text = extra.length ? `${clean(context.heading)}: ${extra.join('. ')}.` : clean(context.heading);
  return text.slice(0, 240);
}

function GeneratePanel({ status, shape, context, onPick }: { status: GenerateStatus; shape: PictureShape; context: PictureSlideContext | null; onPick: PictureFinderProps['onPick'] }) {
  const [prompt, setPrompt] = useState(() => describeSlide(context));
  const [kind, setKind] = useState<NonNullable<PictureStyle['kind']>>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState(savedCode());
  const [made, setMade] = useState<{ blob: Blob; url: string; model: string; prompt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (made) URL.revokeObjectURL(made.url); }, [made]);

  const style = (): PictureStyle => {
    const t = context?.theme;
    return {
      kind,
      look: t?.name,
      lookDescription: t?.description,
      colors: t ? [t.colors.bg, t.colors.accent, t.colors.accent2, t.colors.ink] : [],
      audience: context?.audience,
      purpose: context?.purpose,
    };
  };

  const make = async () => {
    const text = prompt.trim();
    if (text.length < 3) { setError('Describe the picture you want.'); return; }
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError('');
    try {
      const out = await generatePicture(text, shape, style(), c.signal);
      setMade({ blob: out.blob, url: URL.createObjectURL(out.blob), model: out.model, prompt: text });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if ((e as { status?: number }).status === 401) setNeedsCode(true);
      setError((e as Error).message);
    } finally {
      if (controller.current === c) setBusy(false);
    }
  };

  const use = async () => {
    if (!made) return;
    setSaving(true);
    try {
      onPick(await savePicture(made.blob, 'AI picture', { source: 'ai', rights: 'ai', query: made.prompt, model: made.model }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="pf-form" onSubmit={(e) => { e.preventDefault(); void make(); }}>
      <label className="field">
        <span className="field-label">Describe the picture</span>
        <textarea className="textarea" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A raindrop falling into a calm lake at sunrise" autoFocus />
        <span className="field-help">Say what it should show. The style follows this deck’s look and audience.</span>
      </label>
      <div className="field">
        <span className="field-label">Style</span>
        <div className="segmented" role="group" aria-label="Picture style">
          {STYLES.map((s) => <button key={s.id} type="button" aria-pressed={kind === s.id} onClick={() => setKind(s.id)}>{s.label}</button>)}
        </div>
      </div>
      {needsCode && (
        <label className="field">
          <span className="field-label">Access code</span>
          <span className="pf-code-row">
            <input className="input" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { saveCode(code.trim()); setNeedsCode(false); setError(''); }}>Save code</button>
          </span>
          <span className="field-help">The person who runs this site can give you the code.</span>
        </label>
      )}
      {error && <p className="pf-error" role="alert">{error}</p>}
      {busy && (
        <div className="pf-making" role="status">
          <span className="spinner" /> Making your picture. This can take up to a minute.
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { controller.current?.abort(); setBusy(false); }}>Cancel</button>
        </div>
      )}
      {made && !busy && (
        <figure className={`pf-made shape-${shape}`}>
          <img src={made.url} alt={`AI picture: ${made.prompt}`} />
          <figcaption className="faint">Made with {made.model || 'an image model'}. Check the details before you present it.</figcaption>
        </figure>
      )}
      <div className="pf-actions">
        {made && !busy && <button type="button" className="btn btn-primary btn-sm" onClick={use} disabled={saving}>{saving ? <span className="spinner" /> : null} Use this picture</button>}
        <button type="submit" className={`btn btn-sm ${made ? 'btn-secondary' : 'btn-primary'}`} disabled={busy || needsCode}><Sparkles size={14} /> {made ? 'Make another' : 'Make a picture'}</button>
      </div>
      {!made && !busy && <p className="field-help">Your description goes to {status.provider === 'gemini' ? 'Google' : status.provider === 'openai' ? 'OpenAI' : 'an image service'}, and {status.model ?? 'its image model'} makes the picture.</p>}
    </form>
  );
}

import { Check, ChevronRight, ExternalLink, ImagePlus, PenTool, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FieldSpec } from '../../core/kinds/types';
import { RIGHTS_LABEL, captionCredit, creditLine, needsCredit, shortCredit } from '../../core/pictures/credits';
import { searchWords } from '../../core/pictures/rank';
import { assetUrl } from '../../data/repo';
import { useToast } from '../../ui/Toast';
import { NoServerError, downloadPicture } from '../pictures/api';
import { frameShape, searchesFrom, usePictureContext } from '../pictures/context';
import { PictureFinder } from '../pictures/PictureFinder';
import { dismissResult, isStarred, savePicture, starPicture, undismissResult, unstarPicture, useCredit, usePictureMemory } from '../pictures/store';
import { ActivityField, DrawPanel, VideoField } from './MediaFields';

type Content = Record<string, unknown>;

export interface FieldsProps {
  fields: FieldSpec[];
  content: Content;
  onChange(key: string, value: unknown): void;
  prefix?: string;
}

/**
 * Draws the form for a slide kind from its field specs. The content fields come first;
 * switches gather at the end, and fields marked "more" fold away under More options.
 */
export function Fields({ fields, content, onChange, prefix = '' }: FieldsProps) {
  const main = fields.filter((f) => !f.more && f.type !== 'toggle');
  const toggles = fields.filter((f) => !f.more && f.type === 'toggle');
  const more = fields.filter((f) => f.more);
  const draw = (f: FieldSpec) => <Field key={f.key} spec={f} content={content} onChange={onChange} prefix={prefix} />;
  // Open More options when something in it is already set, so nothing set is hidden.
  const set = more.some((f) => {
    const v = content[f.key];
    return typeof v === 'boolean' ? v : Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v != null;
  });
  return (
    <div className="fields">
      {main.map(draw)}
      {toggles.length > 0 && <div className="field-switches">{toggles.map(draw)}</div>}
      {more.length > 0 && (
        <details className="more-options" open={set || undefined}>
          <summary><ChevronRight size={14} aria-hidden /> More options</summary>
          <div className="fields">{more.map(draw)}</div>
        </details>
      )}
    </div>
  );
}

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { minRows = 2, ...rest } = props;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} {...rest} />;
}

function Field({ spec, content, onChange, prefix }: { spec: FieldSpec; content: Content; onChange: FieldsProps['onChange']; prefix: string }) {
  const bind = `${prefix}${spec.key}`;
  const value = content[spec.key];
  const id = `f-${bind.replace(/\W/g, '-')}`;
  switch (spec.type) {
    case 'text':
      return (
        <label className="field" htmlFor={id}>
          <span className="field-label">{spec.label}</span>
          <input id={id} className="input" data-bind={bind} value={typeof value === 'string' ? value : ''} placeholder={spec.placeholder} onChange={(e) => onChange(spec.key, e.target.value)} />
          {spec.help && <span className="field-help">{spec.help}</span>}
        </label>
      );
    case 'textarea':
      return (
        <label className="field" htmlFor={id}>
          <span className="field-label">{spec.label}</span>
          <AutoTextarea id={id} className="textarea" data-bind={bind} minRows={spec.rows ?? 2} value={typeof value === 'string' ? value : ''} placeholder={spec.placeholder} onChange={(e) => onChange(spec.key, e.target.value)} />
          {spec.help && <span className="field-help">{spec.help}</span>}
        </label>
      );
    case 'toggle':
      return (
        <label className="switch" title={spec.help}>
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(spec.key, e.target.checked)} />
          <span>{spec.label}</span>
        </label>
      );
    case 'video':
      return <VideoField spec={spec} value={typeof value === 'string' ? value : ''} onChange={(v) => onChange(spec.key, v)} bind={bind} />;
    case 'activity':
      return <ActivityField spec={spec} content={content} onChange={onChange} bind={bind} />;
    case 'list':
      return <ListField spec={spec} content={content} onChange={onChange} bind={bind} />;
    case 'objects':
      return <ObjectsField spec={spec} content={content} onChange={onChange} bind={bind} />;
    case 'image':
      return <ImageField spec={spec} value={typeof value === 'string' ? value : ''} onChange={(v) => onChange(spec.key, v)} bind={bind} siblings={content} onSibling={onChange} nested={Boolean(prefix)} />;
    default:
      return null;
  }
}

function ListField({ spec, content, onChange, bind }: { spec: Extract<FieldSpec, { type: 'list' }>; content: Content; onChange: FieldsProps['onChange']; bind: string }) {
  const items = Array.isArray(content[spec.key]) ? (content[spec.key] as unknown[]).map((x) => String(x ?? '')) : [];
  const correct = spec.correctKey ? Number(content[spec.correctKey] ?? -1) : -1;
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    if (focusNext.current !== null) {
      refs.current[focusNext.current]?.focus();
      focusNext.current = null;
    }
  });
  const max = spec.max ?? 10;
  const set = (next: string[]) => onChange(spec.key, next);
  const remove = (i: number) => {
    set(items.filter((_, k) => k !== i));
    if (spec.correctKey && correct >= 0) onChange(spec.correctKey, correct === i ? -1 : correct > i ? correct - 1 : correct);
  };
  return (
    <fieldset className="field list-field">
      <legend className="field-label">{spec.label}</legend>
      {items.map((item, i) => (
        <div key={i} className="list-item">
          {spec.correctKey ? (
            <button
              type="button"
              className={`correct-toggle ${correct === i ? 'on' : ''}`}
              aria-pressed={correct === i}
              aria-label={correct === i ? `Choice ${String.fromCharCode(65 + i)} is correct` : `Mark choice ${String.fromCharCode(65 + i)} correct`}
              title={correct === i ? 'Correct answer' : 'Mark as correct'}
              onClick={() => onChange(spec.correctKey!, correct === i ? -1 : i)}
            >
              {correct === i ? <Check size={14} /> : String.fromCharCode(65 + i)}
            </button>
          ) : (
            <span className="list-num">{i + 1}</span>
          )}
          <input
            ref={(el) => { refs.current[i] = el; }}
            className="input"
            data-bind={`${bind}.${i}`}
            value={item}
            placeholder={spec.placeholder ?? spec.itemLabel}
            aria-label={`${spec.itemLabel} ${i + 1}`}
            onChange={(e) => set(items.map((x, k) => (k === i ? e.target.value : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && items.length < max) {
                e.preventDefault();
                const next = [...items];
                next.splice(i + 1, 0, '');
                focusNext.current = i + 1;
                set(next);
              } else if (e.key === 'Backspace' && !item && items.length > 1) {
                e.preventDefault();
                focusNext.current = Math.max(0, i - 1);
                remove(i);
              }
            }}
          />
          <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label={`Remove ${spec.itemLabel.toLowerCase()} ${i + 1}`}><X size={15} /></button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="btn btn-ghost btn-sm add-item" onClick={() => { focusNext.current = items.length; set([...items, '']); }}>
          <Plus size={14} /> Add {spec.itemLabel.toLowerCase()}
        </button>
      )}
      {spec.help && <span className="field-help">{spec.help}</span>}
    </fieldset>
  );
}

function ObjectsField({ spec, content, onChange, bind }: { spec: Extract<FieldSpec, { type: 'objects' }>; content: Content; onChange: FieldsProps['onChange']; bind: string }) {
  const items = Array.isArray(content[spec.key]) ? (content[spec.key] as Content[]) : [];
  const max = spec.max ?? 6;
  const blank = () => Object.fromEntries(spec.fields.map((f) => [f.key, '']));
  return (
    <fieldset className="field objects-field">
      <legend className="field-label">{spec.label}</legend>
      {items.map((item, i) => (
        <div key={i} className="object-item">
          <div className="object-item-head">
            <span className="eyebrow">{spec.itemLabel} {i + 1}</span>
            {items.length > (spec.min ?? 0) && (
              <button type="button" className="icon-btn" onClick={() => onChange(spec.key, items.filter((_, k) => k !== i))} aria-label={`Remove ${spec.itemLabel.toLowerCase()} ${i + 1}`}><Trash2 size={15} /></button>
            )}
          </div>
          <Fields
            fields={spec.fields}
            content={item ?? {}}
            prefix={`${bind}.${i}.`}
            onChange={(k, v) => onChange(spec.key, items.map((x, j) => (j === i ? { ...x, [k]: v } : x)))}
          />
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="btn btn-ghost btn-sm add-item" onClick={() => onChange(spec.key, [...items, blank()])}>
          <Plus size={14} /> Add {spec.itemLabel.toLowerCase()}
        </button>
      )}
    </fieldset>
  );
}

function ImageField({ spec, value, onChange, bind, siblings, onSibling, nested }: {
  spec: Extract<FieldSpec, { type: 'image' }>; value: string; onChange(v: string): void; bind: string;
  /** The other fields next to this one: a gallery item's caption, a person's name, the slide's title. */
  siblings: Content; onSibling(key: string, value: unknown): void; nested: boolean;
}) {
  const context = usePictureContext();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const credit = useCredit(value);
  const memory = usePictureMemory();
  const isAsset = value.startsWith('asset:');
  const starred = isAsset && isStarred(memory, value);
  const str = (key: string) => (typeof siblings[key] === 'string' ? (siblings[key] as string) : '');
  // A picture's caption says best what it shows; then the item's name, the slide's heading and the deck's subject.
  const searches = nested
    ? searchesFrom(str('caption'), str('name'), str('label'), context?.heading, context?.deckTitle)
    : searchesFrom(str('caption'), str('term'), context?.heading, context?.deckTitle);
  const query = searches[0] ?? '';
  const shape = frameShape(context?.kind ?? '', context?.variant, spec.key);

  useEffect(() => {
    let alive = true;
    if (!value) setUrl(null);
    else assetUrl(value).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [value]);

  const run = async (job: () => Promise<string>) => {
    setError('');
    setBusy(true);
    try {
      onChange(await job());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const take = (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose a picture file: JPEG, PNG, WebP, GIF or SVG.'); return; }
    if (file.size > 12 * 1024 * 1024) { setError('This picture is over 12 MB. Choose a smaller one.'); return; }
    void run(() => savePicture(file, file.name, { source: 'upload', rights: 'own' }));
  };

  /** A picture dragged from a web page arrives as a link; it's downloaded like a pasted one. */
  const takeLink = (link: string) => run(async () => {
    try {
      const { blob, url: final } = await downloadPicture(link);
      return await savePicture(blob, 'Picture', { source: 'link', rights: 'unclear', url: final });
    } catch (e) {
      if (e instanceof NoServerError) return link;
      throw e;
    }
  });

  const remove = async () => {
    const before = value;
    const from = credit?.resultId && credit.query ? credit : null;
    onChange('');
    if (from) await dismissResult(from.query!, from.resultId!);
    toast.show(from ? `Picture removed. It won’t be suggested for “${from.query}” again.` : 'Picture removed', {
      action: { label: 'Undo', run: () => { onChange(before); if (from) void undismissResult(from.query!, from.resultId!); } },
    });
  };

  const toggleStar = async () => {
    if (!isAsset) return;
    if (starred) await unstarPicture(value);
    else await starPicture(value, searchWords(`${credit?.query ?? ''} ${query} ${credit?.title ?? ''}`), credit?.title || query);
  };

  // Image and gallery slides have a caption: offer to put a credit there, where the audience sees it.
  const caption = credit && needsCredit(credit) && 'caption' in siblings && !str('caption').trim() ? captionCredit(credit) : '';

  return (
    <div className="field image-field" data-bind={bind} tabIndex={-1}>
      <span className="field-label">{spec.label}</span>
      <div
        className={`image-drop ${url ? 'has-image' : ''} ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          const link = e.dataTransfer.getData('text/uri-list').split('\n').find((l) => /^https?:\/\//i.test(l.trim()));
          if (file) take(file);
          else if (link) void takeLink(link.trim());
        }}
      >
        {url ? <img src={url} alt="" /> : (
          <button type="button" className="image-drop-find" onClick={() => setFinding(true)}>
            <Search size={18} aria-hidden />
            <span>Find a picture</span>
            <span className="faint">or drop one here</span>
          </button>
        )}
        {busy && <span className="image-busy"><span className="spinner" /></span>}
      </div>
      {value && (credit ? (
        <div className="image-credit">
          <span className={`pf-rights rights-${credit.rights}`}>{RIGHTS_LABEL[credit.rights]}</span>
          <span className="image-credit-line" title={creditLine(credit) || undefined}>{shortCredit(credit)}</span>
          {(credit.page || credit.url) && <a href={credit.page || credit.url} target="_blank" rel="noopener noreferrer" className="image-credit-link" aria-label="Open where this picture came from" title="Open where this picture came from"><ExternalLink size={13} /></a>}
        </div>
      ) : /^https?:\/\//i.test(value) ? (
        <div className="image-credit">
          <span className="image-credit-line">Linked from {hostOf(value)}. It shows only while that site keeps it.</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => takeLink(value)} disabled={busy}>Keep a copy</button>
        </div>
      ) : null)}
      {caption && (
        <button type="button" className="btn btn-ghost btn-xs image-caption-btn" onClick={() => onSibling('caption', caption)} title={caption}>
          <Plus size={13} /> Show the credit as the caption
        </button>
      )}
      <div className="image-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFinding(true)}><Search size={14} /> {value ? 'Change' : 'Find a picture'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={busy}><ImagePlus size={14} /> Upload</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrawing((v) => !v)} aria-expanded={drawing} title="Draw a picture with AI, or paste SVG code"><PenTool size={14} /> Draw</button>
        {isAsset && (
          <button type="button" className={`icon-btn image-star ${starred ? 'on' : ''}`} onClick={toggleStar} aria-pressed={starred}
            aria-label={starred ? 'Starred: offered first for similar searches. Click to unstar' : 'Star this picture to reuse it in other slides'}
            title={starred ? 'Starred: offered first when you search for something similar' : 'Star to reuse it in other slides'}>
            <Star size={15} fill={starred ? 'currentColor' : 'none'} />
          </button>
        )}
        {value && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={remove}><Trash2 size={14} /> Remove</button>}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {drawing && (
        <DrawPanel
          shape={shape}
          suggestion={query}
          onClose={() => setDrawing(false)}
          onDone={(ref, note) => { onChange(ref); setDrawing(false); if (note) toast.show(note); }}
        />
      )}
      {error && <span className="field-help field-error" role="alert">{error}</span>}
      {spec.help && <span className="field-help">{spec.help}</span>}
      <PictureFinder
        open={finding}
        onClose={() => setFinding(false)}
        query={query}
        suggestions={searches.slice(1, 4)}
        shape={shape}
        context={context}
        onPick={(ref, note) => { onChange(ref); setFinding(false); if (note) toast.show(note, { duration: 6000 }); }}
      />
    </div>
  );
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'another site'; }
}

import { Check, ImagePlus, Link2, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FieldSpec } from '../../core/kinds/types';
import { assetUrl, saveAsset } from '../../data/repo';

type Content = Record<string, unknown>;

export interface FieldsProps {
  fields: FieldSpec[];
  content: Content;
  onChange(key: string, value: unknown): void;
  prefix?: string;
}

/** Draws the form for a slide kind from its field specs. */
export function Fields({ fields, content, onChange, prefix = '' }: FieldsProps) {
  return (
    <div className="fields">
      {fields.map((f) => <Field key={f.key} spec={f} content={content} onChange={onChange} prefix={prefix} />)}
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
        <label className="switch">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(spec.key, e.target.checked)} />
          <span>{spec.label}</span>
        </label>
      );
    case 'list':
      return <ListField spec={spec} content={content} onChange={onChange} bind={bind} />;
    case 'objects':
      return <ObjectsField spec={spec} content={content} onChange={onChange} bind={bind} />;
    case 'image':
      return <ImageField spec={spec} value={typeof value === 'string' ? value : ''} onChange={(v) => onChange(spec.key, v)} bind={bind} />;
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

function ImageField({ spec, value, onChange, bind }: { spec: Extract<FieldSpec, { type: 'image' }>; value: string; onChange(v: string): void; bind: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    if (!value) setUrl(null);
    else assetUrl(value).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [value]);
  const take = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file (PNG, JPEG, WebP, GIF or SVG).'); return; }
    if (file.size > 12 * 1024 * 1024) { setError('This image is over 12 MB. Choose a smaller one.'); return; }
    onChange(await saveAsset(file, file.name));
  };
  return (
    <div className="field image-field" data-bind={bind} tabIndex={-1}>
      <span className="field-label">{spec.label}</span>
      <div
        className={`image-drop ${url ? 'has-image' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files[0]); }}
      >
        {url ? <img src={url} alt="" /> : <span className="faint">Drop an image here</span>}
      </div>
      <div className="image-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}><ImagePlus size={14} /> {value ? 'Replace' : 'Upload'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinking((x) => !x)}><Link2 size={14} /> Link</button>
        {value && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => onChange('')}><Trash2 size={14} /> Remove</button>}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {linking && (
        <form className="link-row" onSubmit={(e) => { e.preventDefault(); if (/^https?:\/\//i.test(link.trim())) { onChange(link.trim()); setLinking(false); setLink(''); } else setError('Paste a link that starts with http:// or https://'); }}>
          <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" aria-label="Image link" autoFocus />
          <button type="submit" className="btn btn-primary btn-sm">Use link</button>
        </form>
      )}
      {error && <span className="field-help" style={{ color: 'var(--danger)' }}>{error}</span>}
      {spec.help && <span className="field-help">{spec.help}</span>}
    </div>
  );
}

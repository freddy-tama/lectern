import { AlertTriangle, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { makeSlide } from '../../core/deck/draft';
import type { Audience, Slide } from '../../core/deck/types';
import { DECORATIONS, type LogoPosition, type Theme, THEMES, setPreviewTheme } from '../../core/engine/themes';
import { saveLook } from '../../data/looks';
import { assetUrl, saveAsset } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';
import { SlideView } from '../slides/SlideView';
import {
  COLOR_FIELDS, type EditableColor, FONT_CHOICES, HEADING_WEIGHTS, PALETTES, contrastIssues, deriveColors, fontChoiceOf, startFrom,
} from './catalog';
import { normalizeHex } from './color';

const POSITIONS: { id: LogoPosition; label: string }[] = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
];

/** A stable id per draft state, so memoised slide layouts redraw whenever the draft changes. */
function previewIdOf(theme: Theme) {
  const json = JSON.stringify(theme);
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 31) + json.charCodeAt(i)) | 0;
  return `__look-preview-${(h >>> 0).toString(36)}`;
}

function sampleSlides(): Slide[] {
  return [
    makeSlide('title', { eyebrow: 'Quarterly review', title: 'Building what comes next', subtitle: 'Progress, lessons and the plan for spring', presenter: 'Product team' }),
    makeSlide('bullets', { title: 'What we learned', bullets: ['Customers want fewer steps', 'Speed matters more than features', 'Small teams ship faster'] }),
    makeSlide('stats', { title: 'By the numbers', stats: [{ value: '42%', label: 'faster setup' }, { value: '3×', label: 'weekly users' }, { value: '18', label: 'new markets' }] }),
  ];
}

interface LookEditorProps {
  open: boolean;
  /** The look to edit or the starting point for a new one (with a fresh id). */
  initial: Theme | null;
  heading: string;
  audience: Audience;
  onClose(): void;
  onSaved(look: Theme): void;
}

export function LookEditor({ open, initial, heading, audience, onClose, onSaved }: LookEditorProps) {
  const [draft, setDraft] = useState<Theme | null>(initial);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const slides = useMemo(sampleSlides, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => { if (open) setDraft(initial); }, [open, initial]);

  useEffect(() => {
    let alive = true;
    const src = draft?.logo;
    if (!src) setLogoUrl(null);
    else assetUrl(src).then((u) => alive && setLogoUrl(u));
    return () => { alive = false; };
  }, [draft?.logo]);

  const previewId = useMemo(() => {
    if (!draft) return '';
    const id = previewIdOf(draft);
    setPreviewTheme({ ...draft, id });
    return id;
  }, [draft]);

  useEffect(() => {
    if (draft) setPreviewTheme({ ...draft, id: previewId });
    return () => setPreviewTheme(null);
  }, [draft, previewId]);

  if (!draft) return null;
  const issues = contrastIssues(draft);
  const set = (patch: Partial<Theme>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setColors = (patch: Partial<Record<EditableColor, string>>) => setDraft((d) => {
    if (!d) return d;
    const six = Object.fromEntries(COLOR_FIELDS.map(({ key }) => [key, patch[key] ?? d.colors[key]])) as Record<EditableColor, string>;
    return { ...d, colors: deriveColors(six, d.colors.good) };
  });
  const setFont = (role: 'display' | 'body', id: string) => {
    const choice = FONT_CHOICES.find((f) => f.id === id);
    if (choice) set({ [role]: { ...draft[role], web: choice.web, pptx: choice.pptx } });
  };
  const paletteActive = (p: (typeof PALETTES)[number]) => COLOR_FIELDS.every(({ key }) => p.colors[key].toUpperCase() === draft.colors[key].toUpperCase());

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.show('Choose an image file for the logo.', { tone: 'error' }); return; }
    try {
      const src = await saveAsset(file, file.name);
      const url = await assetUrl(src);
      let aspect: number | undefined;
      if (url) {
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {});
        if (img.naturalWidth && img.naturalHeight) aspect = img.naturalWidth / img.naturalHeight;
      }
      set({ logo: src, logoAspect: aspect });
    } catch {
      toast.show('That logo could not be added.', { tone: 'error' });
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const look = await saveLook({ ...draft, name: draft.name.trim() || 'My look' });
      onSaved(look);
    } catch {
      toast.show('The look could not be saved.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const deck = { themeId: previewId, audience, title: draft.name };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={heading}
      wide
      className="look-editor-dialog"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save look'}</button>
        </>
      )}
    >
      <div className="look-editor">
        <div className="look-form">
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="My look" />
          </label>

          <div className="field">
            <span className="field-label">Start from</span>
            <div className="look-bases">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="look-base"
                  aria-pressed={draft.baseId === t.id}
                  onClick={() => setDraft((d) => (d ? startFrom(d, t.id) : d))}
                  title={t.description}
                >
                  <span className="look-base-swatch" style={{ background: t.colors.bg, color: t.colors.ink, fontFamily: t.display.web }}>
                    Aa<i style={{ background: t.colors.accent }} />
                  </span>
                  {t.name}
                </button>
              ))}
            </div>
            <span className="field-help">Replaces colours, fonts and shapes. Your name, logo and footer stay.</span>
          </div>

          <div className="field">
            <span className="field-label">Colours</span>
            <div className="look-palettes">
              {PALETTES.map((p) => (
                <button key={p.id} type="button" className="look-palette" aria-pressed={paletteActive(p)} onClick={() => setColors(p.colors)} title={p.name} aria-label={`${p.name} colours`}>
                  <span style={{ background: p.colors.bg }} />
                  <span style={{ background: p.colors.ink }} />
                  <span style={{ background: p.colors.accent }} />
                  <span style={{ background: p.colors.accent2 }} />
                </button>
              ))}
            </div>
            <div className="look-colors">
              {COLOR_FIELDS.map(({ key, label }) => (
                <ColorInput key={key} label={label} value={draft.colors[key]} onChange={(v) => setColors({ [key]: v })} />
              ))}
            </div>
            {issues.length > 0 && (
              <div className="look-warning" role="status">
                <AlertTriangle size={15} />
                <div>
                  {issues.map((x) => (
                    <p key={x.label}>{x.label} is hard to read ({x.ratio.toFixed(1)}:1). Aim for {x.need}:1 or more.</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="look-row">
            <label className="field">
              <span className="field-label">Heading font</span>
              <FontSelect value={fontChoiceOf(draft.display)?.id} onChange={(id) => setFont('display', id)} />
            </label>
            <label className="field">
              <span className="field-label">Body font</span>
              <FontSelect value={fontChoiceOf(draft.body)?.id} onChange={(id) => setFont('body', id)} />
            </label>
          </div>

          <div className="field">
            <span className="field-label">Heading weight</span>
            <div className="segmented">
              {HEADING_WEIGHTS.map((w) => (
                <button key={w.value} type="button" aria-pressed={nearestWeight(draft.display.weight) === w.value} onClick={() => set({ display: { ...draft.display, weight: w.value } })}>{w.label}</button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Decoration</span>
            <div className="segmented look-wrap">
              {DECORATIONS.map((d) => (
                <button key={d.id} type="button" aria-pressed={draft.decoration === d.id} onClick={() => set({ decoration: d.id })}>{d.label}</button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">Corners <span className="muted">{draft.radius === 0 ? 'Square' : `${draft.radius} px`}</span></span>
            <input type="range" className="look-range" min={0} max={48} step={2} value={draft.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
          </label>

          <div className="field">
            <span className="field-label">Logo</span>
            <div className="look-logo">
              <div className="look-logo-preview" style={{ background: draft.colors.bg }}>
                {logoUrl ? <img src={logoUrl} alt="" /> : <ImagePlus size={20} />}
              </div>
              <div className="look-logo-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>{draft.logo ? 'Replace logo' : 'Upload logo'}</button>
                {draft.logo && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ logo: undefined, logoAspect: undefined })}><Trash2 size={14} /> Remove</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { uploadLogo(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
            {draft.logo && (
              <div className="segmented look-wrap">
                {POSITIONS.map((p) => (
                  <button key={p.id} type="button" aria-pressed={(draft.logoPosition ?? 'top-right') === p.id} onClick={() => set({ logoPosition: p.id })}>{p.label}</button>
                ))}
              </div>
            )}
            <span className="field-help">A PNG or SVG with a transparent background works best.</span>
          </div>

          <label className="field">
            <span className="field-label">Footer</span>
            <input className="input" value={draft.footerText ?? ''} maxLength={80} onChange={(e) => set({ footerText: e.target.value })} placeholder="Company name · Confidential" />
            <span className="field-help">Shown at the bottom of content slides.</span>
          </label>
        </div>

        <div className="look-preview" aria-label="Preview">
          {slides.map((s, i) => (
            <SlideView key={s.id} slide={s} deck={deck} number={i + 1} count={slides.length} framed label={`Preview slide ${i + 1}`} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function nearestWeight(w: number) {
  return HEADING_WEIGHTS.reduce((best, x) => (Math.abs(x.value - w) < Math.abs(best - w) ? x.value : best), HEADING_WEIGHTS[0].value);
}

function FontSelect({ value, onChange }: { value?: string; onChange(id: string): void }) {
  const groups = ['Sans serif', 'Serif', 'Rounded'] as const;
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="" disabled>Look’s own font</option>}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {FONT_CHOICES.filter((f) => f.kind === g).map((f) => <option key={f.id} value={f.id} style={{ fontFamily: f.web }}>{f.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const [textValue, setTextValue] = useState(value);
  useEffect(() => setTextValue(value), [value]);
  return (
    <div className="look-color">
      <input type="color" value={normalizeHex(value) ?? '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={label} />
      <span>
        <span className="look-color-label">{label}</span>
        <input
          className="input-bare look-hex"
          value={textValue}
          spellCheck={false}
          maxLength={7}
          aria-label={`${label} hex value`}
          onChange={(e) => {
            setTextValue(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex && e.target.value.replace('#', '').length === 6) onChange(hex);
          }}
          onBlur={() => setTextValue(value)}
        />
      </span>
    </div>
  );
}

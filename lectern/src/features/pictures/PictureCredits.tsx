import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Copy, ExternalLink, ListPlus, Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Deck } from '../../core/deck/types';
import {
  type PictureCredit, RIGHTS_LABEL, SOURCE_LABEL, creditsText, deckPictures, licenseLimits, needsCredit, pictureLine, rightsOf, slidesLabel,
} from '../../core/pictures/credits';
import { assetUrl } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { pictureCredits, updateCredit } from './store';
import '../../styles/pictures.css';

export interface CreditItem {
  ref: string;
  slides: number[];
  hiddenOnly: boolean;
  credit: PictureCredit | null;
  /** The line for the credits slide, handout and speaker notes. Empty when there's nothing to say. */
  line: string;
}

/** The deck's pictures with their credits, kept up to date. */
export function useDeckCredits(deck: Pick<Deck, 'slides'> | null | undefined): CreditItem[] | undefined {
  const uses = useMemo(() => (deck ? deckPictures(deck) : []), [deck]);
  const key = uses.map((u) => u.ref).join('|');
  const credits = useLiveQuery(() => pictureCredits(uses.map((u) => u.ref)), [key]);
  return useMemo(() => credits && uses.map((u) => {
    const credit = credits.get(u.ref) ?? null;
    return { ...u, credit, line: pictureLine(u.ref, credit) };
  }), [credits, uses]);
}

/** The lines a credits slide shows: every visible picture that has something to credit. */
export function creditSlideLines(items: CreditItem[]): string[] {
  return items.filter((i) => !i.hiddenOnly && i.line).map((i) => `${slidesLabel(i.slides)}: ${i.line}`);
}

interface Props {
  open: boolean;
  onClose(): void;
  deck: Deck;
  /** Adds a credits slide at the end, or updates the one there is. */
  onCreditsSlide(lines: string[]): void;
}

export function PictureCredits({ open, onClose, deck, onCreditsSlide }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Picture credits" wide className="picture-credits"
      description="Where each picture in this deck came from, and how it may be used.">
      {open && <CreditsBody deck={deck} onClose={onClose} onCreditsSlide={onCreditsSlide} />}
    </Dialog>
  );
}

function CreditsBody({ deck, onClose, onCreditsSlide }: Omit<Props, 'open'>) {
  const items = useDeckCredits(deck);
  const [copied, setCopied] = useState(false);
  const [slideDone, setSlideDone] = useState<'' | 'added' | 'updated'>('');
  const [manualCopy, setManualCopy] = useState('');
  const copyBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (manualCopy) { copyBox.current?.focus(); copyBox.current?.select(); } }, [manualCopy]);
  const hasSlide = deck.slides.some((s) => s.kind === 'credits');
  if (!items) return <div className="pf-empty"><span className="spinner" /></div>;
  const shown = items.filter((i) => !i.hiddenOnly);
  const owed = shown.filter((i) => (i.credit ? needsCredit(i.credit) : /^https?:/i.test(i.ref)));
  const lines = creditSlideLines(items);
  const copy = async () => {
    const text = creditsText(deck.title, shown);
    setManualCopy('');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some browsers and embedded views refuse the clipboard: show the text, selected, to copy by hand.
      setManualCopy(text);
    }
  };

  if (!items.length) {
    return (
      <div className="pf-empty">
        <p>This deck has no pictures yet.</p>
        <p className="muted">Pictures you find, link or make keep their credit here.</p>
        <div className="pf-empty-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Done</button></div>
      </div>
    );
  }

  return (
    <div className="pc">
      <p className="pc-summary">
        {items.length} picture{items.length === 1 ? '' : 's'}.{' '}
        {owed.length ? `${owed.length} need${owed.length === 1 ? 's' : ''} a credit the audience can see.` : 'None of them needs a credit on screen.'}
      </p>
      {lines.length > 0 && (owed.length > 0 || hasSlide) && (
        <div className="pc-callout">
          <span>{hasSlide ? 'The credits slide lists these pictures.' : 'Add a credits slide at the end, or show each credit as the picture’s caption.'}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSlideDone(hasSlide ? 'updated' : 'added'); onCreditsSlide(lines); }}>
            {slideDone ? <Check size={14} /> : <ListPlus size={14} />} {slideDone === 'added' ? 'Credits slide added' : slideDone === 'updated' ? 'Credits slide updated' : hasSlide ? 'Update the credits slide' : 'Add a credits slide'}
          </button>
        </div>
      )}
      <ul className="pc-list">
        {items.map((item) => <CreditRow key={item.ref} item={item} />)}
      </ul>
      <p className="faint pc-note">Credits also go in the PowerPoint speaker notes and on the key notes handout.</p>
      {manualCopy && (
        <label className="field">
          <span className="field-label">Your browser didn’t allow copying. Press Ctrl+C (⌘C on a Mac) to copy these credits.</span>
          <textarea className="textarea pc-copy" readOnly rows={6} value={manualCopy} ref={copyBox} />
        </label>
      )}
      <div className="pf-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={copy} disabled={!shown.some((i) => i.line)}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy all'}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function Thumb({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    assetUrl(src).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [src]);
  return <span className="pc-thumb">{url && <img src={url} alt="" referrerPolicy="no-referrer" />}</span>;
}

function CreditRow({ item }: { item: CreditItem }) {
  const { ref, credit } = item;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<PictureCredit>>({});
  const isAsset = ref.startsWith('asset:');
  const where = credit?.page || credit?.url || (isAsset ? '' : ref);
  const limits = credit?.license ? licenseLimits(credit.license) : '';
  const start = () => {
    setDraft({ title: credit?.title ?? '', author: credit?.author ?? '', license: credit?.license ?? '', page: credit?.page ?? '' });
    setEditing(true);
  };
  const save = async () => {
    const license = draft.license?.trim() ?? '';
    const source = credit?.source ?? 'upload';
    const changed = license !== (credit?.license ?? '');
    // A typed licence sets the rights; without one an upload is yours and a link is unknown.
    const rights = !changed && credit ? credit.rights : license ? rightsOf(license) : source === 'upload' ? 'own' : source === 'ai' ? 'ai' : 'unclear';
    const page = /^https?:\/\//i.test(draft.page?.trim() ?? '') ? draft.page!.trim() : '';
    await updateCredit(ref, { title: draft.title?.trim(), author: draft.author?.trim(), license, page, rights });
    setEditing(false);
  };
  return (
    <li className={`pc-row ${item.hiddenOnly ? 'is-hidden' : ''}`}>
      <Thumb src={ref} />
      <div className="pc-main">
        <div className="pc-top">
          <span className="pc-slides">{slidesLabel(item.slides)}{item.hiddenOnly ? ' (hidden)' : ''}</span>
          <span className={`pf-rights rights-${credit?.rights ?? 'unclear'}`}>{credit ? RIGHTS_LABEL[credit.rights] : isAsset ? 'No details' : 'Linked'}</span>
          {credit && <span className="faint pc-source">{SOURCE_LABEL[credit.source]}</span>}
        </div>
        {editing ? (
          <form className="pc-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="field"><span className="field-label">Title</span><input className="input" value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label className="field"><span className="field-label">Made by</span><input className="input" value={draft.author ?? ''} onChange={(e) => setDraft({ ...draft, author: e.target.value })} placeholder="Photographer or artist" /></label>
            <label className="field"><span className="field-label">Licence</span><input className="input" value={draft.license ?? ''} onChange={(e) => setDraft({ ...draft, license: e.target.value })} placeholder="For example CC BY 4.0" /></label>
            <label className="field"><span className="field-label">Source page</span><input className="input" type="url" value={draft.page ?? ''} onChange={(e) => setDraft({ ...draft, page: e.target.value })} placeholder="https://…" /></label>
            <div className="pc-edit-actions">
              <button type="submit" className="btn btn-primary btn-sm">Save credit</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <p className="pc-line">{item.line || <span className="faint">{isAsset ? 'Added from this device, with no credit details.' : ''}</span>}</p>
            {limits && <p className="faint pc-limits">Licence terms: {limits}.</p>}
          </>
        )}
      </div>
      {!editing && (
        <div className="pc-actions">
          {where && /^https?:/i.test(where) && <a className="icon-btn" href={where} target="_blank" rel="noopener noreferrer" aria-label="Open where this picture came from" title="Open where this picture came from"><ExternalLink size={15} /></a>}
          {isAsset && <button type="button" className="icon-btn" onClick={start} aria-label="Edit this credit" title="Edit this credit"><Pencil size={15} /></button>}
        </div>
      )}
    </li>
  );
}

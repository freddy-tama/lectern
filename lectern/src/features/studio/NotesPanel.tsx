import { Minus, Plus, Wand2, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { SPEAKING_WPM, completeNotes, estimateMinutes } from '../../core/deck/draft';
import { wording } from '../../core/deck/purpose';
import type { DeckPurpose, KeyNotes, Slide } from '../../core/deck/types';
import { countWords, lengthLabel } from '../../core/deck/words';
import { installedPlugins } from '../../core/plugins/registry';
import { Fields } from './Fields';
import { ModField } from './ModField';

/** `aside` sits beside the panel's heading, for example the button for your own notes on the slide. */
export function NotesPanel({ slide, purpose = 'talk', onChange, aside }: { slide: Slide; purpose?: DeckPurpose; onChange(notes: KeyNotes, key: string): void; aside?: ReactNode }) {
  const w = wording(purpose);
  const notes = slide.notes;
  const [cue, setCue] = useState('');
  const talk = countWords(notes.script) / SPEAKING_WPM;
  const set = (patch: Partial<KeyNotes>, key: string) => onChange({ ...notes, ...patch }, `${slide.id}:notes:${key}`);
  const modGroups = installedPlugins().filter((p) => p.notesFields?.length).map((p) => ({ plugin: p.id, name: p.name, fields: p.notesFields! }));
  const addCue = (value: string) => {
    const v = value.trim();
    if (v && !notes.cues.includes(v)) set({ cues: [...notes.cues, v] }, 'cues');
    setCue('');
  };

  return (
    <section className="notes-panel" aria-labelledby="notes-title">
      <div className="notes-script">
        <div className="notes-head">
          <div>
            <h2 id="notes-title">Key notes</h2>
            <p className="faint">{w.notesHelp}</p>
          </div>
          <div className="nt-head-actions">
            {aside}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Fill empty notes from the slide’s text"
              onClick={() => onChange(completeNotes({ ...slide, notes: { ...notes, script: notes.script, keyPoints: notes.keyPoints } }).notes, `${slide.id}:notes:draft`)}
              disabled={Boolean(notes.script.trim() && notes.keyPoints.length)}
            >
              <Wand2 size={14} /> Fill from slide
            </button>
          </div>
        </div>
        <label className="field">
          <span className="field-label">Script</span>
          <textarea
            className="textarea script-input"
            data-bind="notes.script"
            value={notes.script}
            onChange={(e) => set({ script: e.target.value }, 'script')}
            placeholder="Write it the way you’d say it. Blank lines become pauses on the teleprompter."
          />
        </label>
        <div className="notes-meta faint">
          <span>{lengthLabel(notes.script)}</span>
          <span aria-hidden>·</span>
          <span>{talk < 0.5 ? 'under a minute' : `about ${Math.max(1, Math.round(talk))} min`} to say</span>
        </div>
      </div>

      <div className="notes-side">
        <Fields
          fields={[{ key: 'keyPoints', label: w.keyPointsLabel, type: 'list', itemLabel: 'Point', max: 6, placeholder: w.keyPointsPlaceholder }]}
          content={notes as unknown as Record<string, unknown>}
          prefix="notes."
          onChange={(_, v) => set({ keyPoints: v as string[] }, 'keyPoints')}
        />

        <fieldset className="field">
          <legend className="field-label">{w.checkLabel}</legend>
          <input className="input" placeholder={w.checkQuestionPlaceholder} value={notes.check?.question ?? ''} onChange={(e) => set({ check: e.target.value || notes.check?.answer ? { question: e.target.value, answer: notes.check?.answer ?? '' } : null }, 'checkQ')} aria-label={w.checkQuestionAria} />
          <input className="input" placeholder={w.checkAnswerPlaceholder} value={notes.check?.answer ?? ''} onChange={(e) => set({ check: { question: notes.check?.question ?? '', answer: e.target.value } }, 'checkA')} aria-label={w.checkAnswerAria} />
        </fieldset>

        <fieldset className="field">
          <legend className="field-label">Cues</legend>
          <div className="cue-list">
            {notes.cues.map((c) => (
              <span key={c} className="chip cue-chip">{c}<button type="button" onClick={() => set({ cues: notes.cues.filter((x) => x !== c) }, 'cues')} aria-label={`Remove cue ${c}`}><X size={12} /></button></span>
            ))}
            <input
              className="input-bare cue-input"
              value={cue}
              list="cue-ideas"
              placeholder={notes.cues.length ? 'Add a cue' : w.cuePlaceholder}
              onChange={(e) => setCue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCue(cue); } }}
              onBlur={() => cue && addCue(cue)}
              aria-label="Add a cue"
            />
            <datalist id="cue-ideas">{w.cueIdeas.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        </fieldset>

        <div className="field">
          <span className="field-label">Time on this slide</span>
          <div className="stepper">
            <button type="button" className="icon-btn" aria-label="Less time" onClick={() => set({ minutes: Math.max(0.5, notes.minutes - 0.5) }, 'min')}><Minus size={15} /></button>
            <span className="tabular">{notes.minutes} min</span>
            <button type="button" className="icon-btn" aria-label="More time" onClick={() => set({ minutes: Math.min(60, notes.minutes + 0.5) }, 'min')}><Plus size={15} /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ minutes: estimateMinutes(notes, slide.kind) }, 'min')}>Estimate</button>
          </div>
        </div>

        {modGroups.map((g) => (
          <div key={g.plugin} className="mod-notes">
            <h3 className="mod-notes-title">{g.name}</h3>
            {g.fields.map((f) => (
              <ModField
                key={f.key}
                field={f}
                value={notes.extra?.[g.plugin]?.[f.key] ?? ''}
                onChange={(v) => set({ extra: { ...notes.extra, [g.plugin]: { ...notes.extra?.[g.plugin], [f.key]: v } } }, `extra.${g.plugin}.${f.key}`)}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

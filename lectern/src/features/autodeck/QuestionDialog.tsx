import { ArrowLeft, Bookmark, Check, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import type { AiQuestion } from './ai';

export interface Answer {
  key: string;
  question: string;
  answer: string;
  remember: boolean;
}

interface Draft {
  picked: string[];
  other: string;
  remember: boolean;
}

/**
 * The AI's questions, one at a time. Every question can be skipped, and "Make it now"
 * skips the rest. Answers marked "Remember" are kept for future decks.
 */
export function QuestionDialog({ open, questions, onDone, onCancel }: {
  open: boolean;
  questions: AiQuestion[];
  onDone(answers: Answer[]): void;
  onCancel(): void;
}) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setDrafts(Object.fromEntries(questions.map((q) => [q.key, { picked: [], other: '', remember: q.remember }])));
  }, [open, questions]);

  useEffect(() => { if (open) first.current?.focus(); }, [open, index]);

  const q = questions[index];
  if (!q) return null;
  const d = drafts[q.key] ?? { picked: [], other: '', remember: q.remember };
  const set = (patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [q.key]: { ...d, ...patch } }));

  const answers = (from: Record<string, Draft>): Answer[] => questions.flatMap((x) => {
    const v = from[x.key];
    const answer = [...(v?.picked ?? []), v?.other.trim() ?? ''].filter(Boolean).join('; ');
    return answer ? [{ key: x.key, question: x.question, answer, remember: Boolean(v?.remember && x.remember) }] : [];
  });

  const last = index === questions.length - 1;
  const advance = (from = drafts) => (last ? onDone(answers(from)) : setIndex(index + 1));

  const pick = (option: string) => {
    if (q.multiple) {
      set({ picked: d.picked.includes(option) ? d.picked.filter((o) => o !== option) : [...d.picked, option] });
      return;
    }
    // A single choice moves on by itself, so a quick answer is one click.
    const next = { ...drafts, [q.key]: { ...d, picked: [option] } };
    setDrafts(next);
    window.setTimeout(() => advance(next), 160);
  };

  const answered = d.picked.length > 0 || d.other.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      className="ad-ask"
      title={<span className="ad-ask-title"><Sparkles size={17} /> A few quick questions</span>}
      description={questions.length > 1 ? `Question ${index + 1} of ${questions.length}. Skip any you like.` : 'Skip it if you like.'}
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-sm ad-ask-now" onClick={() => onDone(answers(drafts))}>Make it now</button>
          {index > 0 && <button type="button" className="btn btn-ghost" onClick={() => setIndex(index - 1)}><ArrowLeft size={15} /> Back</button>}
          <button type="button" className={`btn ${answered ? 'btn-primary' : 'btn-secondary'}`} onClick={() => advance()}>
            {answered ? (last ? 'Make the deck' : 'Next') : 'Skip'}
          </button>
        </>
      )}
    >
      <div className="ad-ask-body" key={q.key}>
        <div className="ad-ask-dots" aria-hidden>
          {questions.map((x, i) => <span key={x.key} className={i < index ? 'is-done' : i === index ? 'is-current' : ''} />)}
        </div>
        <h3 className="ad-ask-q" id={`ad-q-${q.key}`}>{q.question}</h3>
        {q.multiple && <p className="faint ad-ask-hint">Choose any that apply.</p>}
        <div className="ad-ask-options" role={q.multiple ? 'group' : 'radiogroup'} aria-labelledby={`ad-q-${q.key}`}>
          {q.options.map((o, i) => {
            const on = d.picked.includes(o);
            return (
              <button
                key={o}
                ref={i === 0 ? first : undefined}
                type="button"
                role={q.multiple ? 'checkbox' : 'radio'}
                aria-checked={on}
                className="ad-ask-option"
                onClick={() => pick(o)}
              >
                <span className={`ad-ask-mark ${q.multiple ? 'is-box' : ''}`} aria-hidden><Check size={12} strokeWidth={3} /></span>
                <span>{o}</span>
                {i === 0 && !q.multiple && <span className="ad-ask-guess">Suggested</span>}
              </button>
            );
          })}
        </div>
        <label className="field">
          <span className="field-label">Or in your own words</span>
          <input
            className="input"
            value={d.other}
            onChange={(e) => set({ other: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); advance(); } }}
            placeholder="Type an answer"
          />
        </label>
        {q.remember && (
          <label className="switch ad-ask-remember">
            <input type="checkbox" checked={d.remember} onChange={(e) => set({ remember: e.target.checked })} />
            <span><Bookmark size={13} /> Remember this for my next decks</span>
          </label>
        )}
      </div>
    </Dialog>
  );
}

import type { Deck } from '../../core/deck/types';

export interface StudyCard {
  id: string;
  slideId: string;
  front: string;
  back: string;
  source: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Flashcards drawn from key terms, recall prompts, questions and key-note checks. */
export function deckCards(deck: Deck): StudyCard[] {
  const cards: StudyCard[] = [];
  for (const s of deck.slides.filter((x) => !x.hidden)) {
    const c = s.content as Record<string, unknown>;
    if (s.kind === 'term' && str(c.term) && str(c.definition)) {
      cards.push({ id: `${s.id}:term`, slideId: s.id, front: str(c.term), back: [str(c.definition), str(c.example) && `e.g. ${str(c.example)}`].filter(Boolean).join('\n\n'), source: 'Key term' });
    }
    if (s.kind === 'recall' && Array.isArray(c.cards)) {
      (c.cards as Record<string, unknown>[]).forEach((k, i) => {
        if (str(k?.prompt) && str(k?.answer)) cards.push({ id: `${s.id}:r${i}`, slideId: s.id, front: str(k.prompt), back: str(k.answer), source: 'Recall' });
      });
    }
    if (s.kind === 'question' && str(c.question)) {
      const options = Array.isArray(c.options) ? (c.options as unknown[]).map(str) : [];
      const correct = Number(c.correct);
      const right = Number.isInteger(correct) && options[correct] ? `${String.fromCharCode(65 + correct)}. ${options[correct]}` : '';
      const back = [right, str(c.answer)].filter(Boolean).join('\n\n');
      if (back) cards.push({ id: `${s.id}:q`, slideId: s.id, front: [str(c.question), ...options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`)].join('\n'), back, source: 'Question' });
    }
    if (s.notes.check?.question && s.notes.check.answer) {
      cards.push({ id: `${s.id}:check`, slideId: s.id, front: s.notes.check.question, back: s.notes.check.answer, source: 'Check' });
    }
  }
  return cards;
}

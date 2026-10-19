// Builds the offline copies of a deck: the quiz and a text-only version of the
// slides as links (for QR codes), and the matching single-file web pages.

import type { Deck } from '../../core/deck/types';
import { makeQuiz } from '../../core/deck/quiz-maker';
import type { TextBox } from '../../core/engine/boxes';
import { layoutSlide } from '../../core/engine/layout';
import { getTheme } from '../../core/engine/themes';
import { type LiteSlide, type QuizPack, type SlidesPack, encodePack, fitsQr, packUrl, quizPackFrom } from '../../core/share/pack';

export interface OfflineCopy<P> {
  pack: P;
  url: string;
  /** The link is short enough for a QR code. */
  fits: boolean;
}

export interface OfflineCopies {
  /** Null when the deck has nothing to quiz on. */
  quiz: (OfflineCopy<QuizPack> & { made: boolean }) | null;
  slides: OfflineCopy<SlidesPack>;
}

function lines(text: string): string[] {
  return text.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The words on each slide, as laid out: the biggest text is the heading. Answers stay hidden. */
export function slidesPackFrom(deck: Deck): SlidesPack {
  const theme = getTheme(deck.themeId);
  const visible = deck.slides.filter((s) => !s.hidden);
  const slides: LiteSlide[] = [];
  visible.forEach((slide, n) => {
    const layout = layoutSlide(slide, { theme, audience: deck.audience, mode: 'show', slideNumber: n + 1, slideCount: visible.length, deckTitle: deck.title });
    const texts = layout.boxes.filter((b): b is TextBox => b.type === 'text' && !!b.bind && b.reveal !== 'answer' && !!b.text.trim());
    if (!texts.length) return;
    const top = texts.reduce((a, b) => (b.style.size > a.style.size ? b : a));
    slides.push({ h: lines(top.text).join(' '), b: texts.filter((t) => t !== top).flatMap((t) => lines(t.text)) });
  });
  return { v: 1, t: 'slides', title: deck.title, slides };
}

/** The deck's scored questions, or a quiz made from its key notes when it has none. */
export function quizPackFor(deck: Deck): { pack: QuizPack; made: boolean } | null {
  const own = quizPackFrom(deck.title, deck.slides);
  if (own.items.length) return { pack: own, made: false };
  const made = quizPackFrom(deck.title, makeQuiz(deck));
  return made.items.length ? { pack: made, made: true } : null;
}

export async function offlineCopies(deck: Deck, origin = window.location.origin): Promise<OfflineCopies> {
  const quiz = quizPackFor(deck);
  const slides = slidesPackFrom(deck);
  const slidesUrl = packUrl(origin, await encodePack(slides));
  let quizCopy: OfflineCopies['quiz'] = null;
  if (quiz) {
    const url = packUrl(origin, await encodePack(quiz.pack));
    quizCopy = { pack: quiz.pack, url, fits: fitsQr(url), made: quiz.made };
  }
  return { quiz: quizCopy, slides: { pack: slides, url: slidesUrl, fits: fitsQr(slidesUrl) } };
}

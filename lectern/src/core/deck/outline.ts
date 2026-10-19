// Turns pasted notes or a Markdown outline into a deck draft, offline.
// Short, scannable text goes on the slide; longer prose goes to the key notes.
//
//   # Deck title            → title slide (the next plain line is the subtitle)
//   ## Slide title          → a new slide; its kind is guessed from the heading and body
//   - point / 1. point      → points (an ordered "Label: detail" list becomes steps)
//   Q: … / A) … / Answer: … → a question with choices
//   > quote  / — Author     → a quote
//   Term: meaning           → key terms, under a "Vocabulary" or "Key terms" heading
//   Notes: …                → key notes script for the slide
//   ![alt](url)             → an image
//   | a | b | + |---|---|   → a table
//   ---                     → slide break

import type { DeckDraft } from '../plugins/api';
import type { KeyNotes } from './types';
import { countWords } from './words';

type DraftSlide = DeckDraft['slides'][number];

interface Block {
  heading: string;
  level: number;
  lines: string[];
}

const BULLET = /^\s*(?:[-*•▪◦]|\d+[.)])\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const OPTION = /^\s*(?:\(?([A-Fa-f])[).:]|-\s*\[( |x|X)\])\s+(.*)$/;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const is = (heading: string, ...words: string[]) => new RegExp(`^(${words.join('|')})\\b`, 'i').test(heading.trim());

function words(s: string) {
  return countWords(s);
}

function sentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').match(/[^.!?。！？]+[.!?。！？]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

function splitBlocks(text: string): { title: string; subtitle: string; blocks: Block[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  let subtitle = '';
  const blocks: Block[] = [];
  let current: Block | null = null;
  let beforeFirst = true;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h && h[1].length === 1 && !title && beforeFirst) {
      title = h[2].trim();
      continue;
    }
    if (h) {
      beforeFirst = false;
      current = { heading: h[2].trim(), level: h[1].length, lines: [] };
      blocks.push(current);
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) {
      beforeFirst = false;
      current = { heading: '', level: 2, lines: [] };
      blocks.push(current);
      continue;
    }
    if (beforeFirst) {
      if (title && !subtitle && line.trim() && !BULLET.test(line)) { subtitle = line.trim(); continue; }
      if (!line.trim()) continue;
      if (!title) {
        // No "# title": the first line names the deck.
        title = line.replace(/^#+\s*/, '').trim();
        continue;
      }
      beforeFirst = false;
      current = { heading: '', level: 2, lines: [] };
      blocks.push(current);
    }
    current?.lines.push(line);
  }
  return { title, subtitle, blocks };
}

/** Plain text without headings: every paragraph becomes a slide. */
function paragraphsToBlocks(text: string): Block[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const [first, ...rest] = sentences(p);
    const heading = first && words(first) <= 10 ? first.replace(/[.:]$/, '') : '';
    return { heading, level: 2, lines: heading ? [rest.join(' ')] : p.split('\n') };
  });
}

function notesFrom(lines: string[]): { script: string; rest: string[] } {
  const rest: string[] = [];
  const script: string[] = [];
  let inNotes = false;
  for (const line of lines) {
    const m = /^\s*(?:notes?|say|script|speaker notes?)\s*:\s*(.*)$/i.exec(line);
    if (m) { inNotes = true; if (m[1].trim()) script.push(m[1].trim()); continue; }
    if (inNotes && line.trim() && !BULLET.test(line)) { script.push(line.trim()); continue; }
    if (inNotes && !line.trim()) { inNotes = false; continue; }
    rest.push(line);
  }
  return { script: script.join(' '), rest };
}

/** A Markdown pipe table: a header row, a |---| separator, then rows. Returns its lines and the rest. */
function pipeTable(lines: string[]): { cells: string; rest: string[] } | null {
  const sep = lines.findIndex((l, i) => i > 0 && l.includes('|') && TABLE_SEP.test(l) && lines[i - 1].includes('|'));
  if (sep < 0) return null;
  let end = sep + 1;
  while (end < lines.length && lines[end].includes('|') && lines[end].trim()) end++;
  const split = (l: string) => l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
  // Keep the separator only when it sets column alignment.
  const aligned = /:/.test(lines[sep]);
  const rows = [lines[sep - 1], ...(aligned ? [lines[sep]] : []), ...lines.slice(sep + 1, end)];
  const cells = rows.map((l) => split(l).join(' | ')).join('\n');
  return { cells, rest: [...lines.slice(0, sep - 1), ...lines.slice(end)] };
}

function blockToSlides(block: Block, index: number): DraftSlide[] {
  const { script, rest } = notesFrom(block.lines);
  const heading = block.heading.replace(/[:：]\s*$/, '');
  const content = rest.filter((l) => l.trim());
  const bullets = content.filter((l) => BULLET.test(l)).map((l) => BULLET.exec(l)![1].trim());
  const ordered = content.filter((l) => ORDERED.test(l));
  const prose = content.filter((l) => !BULLET.test(l) && !OPTION.test(l) && !IMAGE.test(l) && !/^\s*>/.test(l)).map((l) => l.trim());
  const image = content.map((l) => IMAGE.exec(l)).find(Boolean);
  const notes: Partial<KeyNotes> = script ? { script } : {};

  // A pipe table becomes a table slide; a short line beside it is the caption.
  const tableLines = pipeTable(rest);
  if (tableLines) {
    const other = tableLines.rest.map((l) => l.trim()).filter(Boolean).map((l) => (BULLET.exec(l)?.[1] ?? l).trim());
    const caption = other.length === 1 && words(other[0]) <= 16 ? other[0] : '';
    const extra = caption ? '' : other.join(' ');
    return [{
      kind: 'table',
      content: { title: heading || 'Table', cells: tableLines.cells, header: true, stripes: true, caption },
      notes: { ...notes, script: [notes.script, extra].filter(Boolean).join(' ') },
    }];
  }

  // Question with optional choices.
  const qLine = content.find((l) => /^\s*(?:q|question)\s*[:.]/i.test(l));
  if (qLine || is(heading, 'quiz', 'check', 'question')) {
    const question = qLine ? qLine.replace(/^\s*(?:q|question)\s*[:.]\s*/i, '').trim() : prose[0] ?? heading;
    const options: string[] = [];
    let correct = -1;
    for (const l of content) {
      const m = OPTION.exec(l);
      if (!m) continue;
      if (m[2] && /x/i.test(m[2])) correct = options.length;
      options.push(m[3].replace(/\s*\*$/, '').trim());
      if (/\*\s*$/.test(l) || /\(correct\)/i.test(l)) correct = options.length - 1;
    }
    const aLine = content.find((l) => /^\s*(?:a|answer)\s*:/i.test(l) && !OPTION.test(l));
    const answer = aLine ? aLine.replace(/^\s*(?:a|answer)\s*:\s*/i, '').trim() : '';
    if (correct < 0 && answer && options.length) {
      const letter = /^([A-F])\b/i.exec(answer)?.[1];
      correct = letter ? letter.toUpperCase().charCodeAt(0) - 65 : options.findIndex((o) => o.toLowerCase() === answer.toLowerCase());
    }
    return [{ kind: 'question', content: { question, options: options.map((o) => o.replace(/\s*\(correct\)/i, '')), correct, answer }, notes: { ...notes, check: null } }];
  }

  // Quote.
  const quoteLines = content.filter((l) => /^\s*>/.test(l)).map((l) => l.replace(/^\s*>\s?/, '').trim());
  if (quoteLines.length && !bullets.length) {
    const who = content.find((l) => /^\s*[—–-]{1,2}\s*\S/.test(l) && !BULLET.test(l))?.replace(/^\s*[—–-]{1,2}\s*/, '') ?? '';
    return [{ kind: 'quote', content: { quote: quoteLines.join(' ').replace(/^["“]|["”]$/g, ''), attribution: who }, notes }];
  }

  // Vocabulary: one key-term slide per "term: meaning" line.
  const pairs = content.map((l) => /^\s*(?:[-*•]\s*)?([^:：—–]{1,40}?)\s*(?:[:：]|\s[—–]\s)\s*(.+)$/.exec(l)).filter(Boolean) as RegExpExecArray[];
  if (is(heading, 'vocabulary', 'key terms?', 'glossary', 'terms', 'definitions?') && pairs.length) {
    return pairs.map((m) => ({ kind: 'term', content: { label: 'Key term', term: m[1].trim(), definition: m[2].trim(), example: '' }, notes: { keyPoints: [`${m[1].trim()}: ${m[2].trim()}`] } }));
  }

  if (is(heading, 'agenda', 'today', 'outline', 'plan', 'overview', 'contents') && bullets.length) {
    return [{ kind: 'agenda', content: { title: heading, items: bullets.slice(0, 7) }, notes }];
  }
  if (is(heading, 'summary', 'key takeaways?', 'takeaways?', 'recap', 'review', 'in short', 'conclusion') && (bullets.length || prose.length)) {
    return [{ kind: 'summary', content: { title: heading, points: (bullets.length ? bullets : prose.flatMap(sentences)).slice(0, 6) }, notes }];
  }
  if (is(heading, 'exit ticket', 'before you go', 'reflection', 'reflect', 'homework', 'questions to think about')) {
    return [{ kind: 'closing', content: { title: heading, prompts: (bullets.length ? bullets : prose).slice(0, 4), closing: '' }, notes }];
  }

  // Ordered "Label: detail" lists or a process heading become steps.
  if ((ordered.length >= 2 && ordered.length <= 6 && ordered.length === bullets.length) || (is(heading, 'steps', 'process', 'timeline', 'how it works', 'stages') && bullets.length >= 2 && bullets.length <= 6)) {
    const steps = bullets.map((b) => {
      const m = /^(.{1,40}?)\s*(?:[:：]|\s[—–]\s)\s*(.+)$/.exec(b);
      return m ? { label: m[1].trim(), detail: m[2].trim() } : { label: b, detail: '' };
    });
    if (steps.every((s) => words(s.label) <= 6)) return [{ kind: 'steps', content: { title: heading, steps, reveal: true }, notes }];
  }

  // A heading alone (or "Part 2 …") divides the lesson.
  if (!content.length || (is(heading, 'part', 'section', 'unit', 'chapter', 'module') && !bullets.length && prose.length <= 1)) {
    return [{ kind: 'section', content: { number: String(index + 1).padStart(2, '0'), title: heading || 'Section', subtitle: prose[0] ?? '' }, notes }];
  }

  // Prose: keep the gist on the slide, the full text in the key notes.
  if (!bullets.length && prose.length) {
    const text = prose.join(' ');
    const all = sentences(text);
    if (image) return [{ kind: 'image', content: { title: heading || all[0] || 'Look closely', body: all.slice(0, 2).join(' '), image: image[2], caption: image[1] }, notes: { ...notes, script: notes.script || text } }];
    if (words(text) <= 22) return [{ kind: 'bullets', content: { title: heading || 'Key idea', bullets: all, reveal: false }, notes }];
    const points = all.filter((s) => words(s) <= 24).slice(0, 4);
    return [{ kind: 'bullets', content: { title: heading || all[0], bullets: points.length ? points : [all[0]], reveal: false }, notes: { ...notes, script: notes.script || text } }];
  }

  // Default: points. Long points move to the script; the slide keeps a short version.
  const short = bullets.map((b) => (words(b) > 24 ? `${sentences(b)[0] ?? b}` : b));
  const longText = bullets.filter((b) => words(b) > 24).join(' ');
  const extraProse = prose.join(' ');
  return [{
    kind: 'bullets',
    content: { title: heading || 'Key points', bullets: short.slice(0, 8), reveal: bullets.length >= 3, ...(image ? { image: image[2] } : {}) },
    notes: { ...notes, script: notes.script || [extraProse, longText].filter(Boolean).join(' ') },
  }];
}

export function outlineToDraft(source: string, fallbackTitle = 'Untitled deck'): DeckDraft {
  const text = source.trim();
  const parsed = splitBlocks(text);
  let blocks = parsed.blocks;
  const hasHeadings = /^#{1,4}\s/m.test(text);
  if (!hasHeadings && blocks.length <= 1) blocks = paragraphsToBlocks(text.split('\n').slice(parsed.title ? 1 : 0).join('\n'));
  const title = parsed.title || fallbackTitle;
  const slides: DraftSlide[] = [{ kind: 'title', content: { title, subtitle: parsed.subtitle, eyebrow: '', presenter: '' } }];
  let sectionIndex = 0;
  for (const block of blocks) {
    const made = blockToSlides(block, sectionIndex);
    if (made[0]?.kind === 'section') sectionIndex += 1;
    slides.push(...made);
  }
  return { title, slides };
}

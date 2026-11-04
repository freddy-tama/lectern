// Practice written on slides the way worksheets write it, found in imported text:
//   The Sun is a star. （√）
//   The Moon makes its own light. （×，it reflects sunlight）  → statements to judge
//   Plants need （　） to grow.  /  Plants need ____ to grow.
//   Word bank: water, salt, sand                            → a passage to fill from a bank
// Numbered notes (①②…) and lettered choices are left alone.

export interface FoundStatement {
  statement: string;
  isTrue: boolean;
  /** For a false statement: what is true, when the slide says. */
  correction: string;
}

export type FoundPractice =
  | { kind: 'true-false'; items: FoundStatement[] }
  /** Blanks are written "[ ]": the answers aren't on the slide, only the bank. */
  | { kind: 'fill-in'; passage: string; bank: string[] };

const NUMBER = /^\s*(?:\(?\d{1,2}[.)．、]|[-*•▪◦])\s*/;
const TRUE = '√✓✔☑';
const MARKS = '√✓✔☑×✗✘☒';
const VERDICT_END = new RegExp(`^(.+?)\\s*[(（]\\s*([${MARKS}])\\s*(?:[,，、;；:：]\\s*(.*?))?\\s*[)）]\\s*[。.]?$`);
const VERDICT_START = new RegExp(`^[(（]\\s*([${MARKS}])\\s*[)）]\\s*(.+)$`);
const GAP = /[(（][\s　]*[)）]|_{3,}/;
const GAPS = new RegExp(GAP.source, 'g');
const BANK_LABEL = /^(?:word\s*bank|words?|choose from|use these words|词语|词库|选词填空|选词|备选词语?)\s*[:：]\s*/i;
const HAN_ONLY = /^[\p{Script=Han}\s、，,;；/|]+$/u;

function verdict(line: string): FoundStatement | null {
  const bare = line.replace(NUMBER, '').trim();
  const end = VERDICT_END.exec(bare);
  if (end) return { statement: end[1]!.trim(), isTrue: TRUE.includes(end[2]!), correction: (end[3] ?? '').trim() };
  const start = VERDICT_START.exec(bare);
  return start ? { statement: start[2]!.trim(), isTrue: TRUE.includes(start[1]!), correction: '' } : null;
}

/** The words of a word-bank line, or null when the line reads like a sentence. */
export function bankWords(line: string): string[] | null {
  const labelled = BANK_LABEL.test(line);
  const rest = line.replace(BANK_LABEL, '').trim().replace(/^[[(（【「]\s*/, '').replace(/\s*[\])）】」]$/, '');
  const marked = /[、,，;；/|]|\s{2,}|　/.test(rest);
  const sep = marked ? /\s*(?:[、,，;；/|]|\s{2,}|　)\s*/ : labelled || HAN_ONLY.test(rest) ? /\s+/ : null;
  if (!sep) return null;
  const words = rest.split(sep).map((w) => w.trim()).filter(Boolean);
  if (words.length < 2 || words.length > 12) return null;
  if (words.some((w) => w.length > 16 || w.split(/\s+/).length > 3 || /[。.!?！？]$/.test(w))) return null;
  return words;
}

/**
 * Statements marked right or wrong (two or more) become statements to judge; lines with empty
 * brackets or a long underline, beside a word-bank line, become a passage to fill. Null otherwise.
 */
export function findPractice(text: string): FoundPractice | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const items = lines.map(verdict).filter((s): s is FoundStatement => !!s);
  if (items.length >= 2) return { kind: 'true-false', items: items.slice(0, 6) };
  const gapped = lines.filter((l) => GAP.test(l));
  if (!gapped.length) return null;
  const bank = lines.filter((l) => !GAP.test(l)).map(bankWords).find(Boolean);
  if (!bank) return null;
  const passage = gapped.map((l) => l.replace(NUMBER, '').replace(GAPS, '[ ]').replace(/\s+/g, ' ').trim()).join(' ');
  return { kind: 'fill-in', passage, bank };
}

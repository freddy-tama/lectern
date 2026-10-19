// Pinyin helpers: tone numbers to tone marks, and a forgiving word-list parser.

const MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

const TONE_MARKED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;

/** "ni3 hao3" → "nǐ hǎo". Text that already has tone marks passes through unchanged. */
export function toneMarks(value: string): string {
  return value.replace(/([a-zü]+(?::)?[a-zü]*)([1-5])/gi, (_m, syllable: string, digit: string) => {
    const word = syllable.replace(/u:|v/g, 'ü').replace(/U:|V/g, 'Ü');
    const tone = Number(digit);
    if (tone === 5) return word;
    const lower = word.toLowerCase();
    let at = lower.search(/[ae]/);
    if (at < 0) at = lower.indexOf('ou');
    if (at < 0) {
      for (let i = lower.length - 1; i >= 0; i--) {
        if ('aeiouü'.includes(lower[i])) { at = i; break; }
      }
    }
    if (at < 0) return word;
    const mark = MARKS[lower[at]][tone - 1];
    return word.slice(0, at) + (word[at] === lower[at] ? mark : mark.toUpperCase()) + word.slice(at + 1);
  });
}

const looksLikePinyin = (token: string) => TONE_MARKED.test(token) || /^([a-zü:v]+[1-5])+$/i.test(token);

/** One toneless pinyin syllable, for neutral tones such as the "sheng" of xuésheng. */
const SYLLABLE = /^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:iang|iong|uang|ueng|ang|eng|ing|ong|iao|ian|uai|uan|üan|ai|ei|ao|ou|an|en|er|ia|ie|iu|in|ua|uo|ui|un|üe|ue|ün|a|o|e|i|u|ü|v)$/i;
const bare = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '');
const isSyllable = (token: string) => SYLLABLE.test(bare(token));

/** Rough syllable count: one per group of vowels. */
const syllables = (value: string) => (bare(value).match(/[aeiouv]+/gi) ?? []).length;

export interface WordEntry {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

/**
 * One entry per line. All of these work:
 *   学 xué to study        学 xue2 to study       学（xué）to study
 *   学 | xué | to study    学<tab>xué<tab>to study
 * Without tone marks or numbers, put a tab, "|" or two spaces between the columns.
 */
export function parseWordList(text: string): WordEntry[] {
  const out: WordEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:\d+[.、)]|[-*•])\s*/, '').trim();
    const head = /^([\p{Script=Han}·]+)\s*(.*)$/u.exec(line);
    if (!head) continue;
    const hanzi = head[1];
    const rest = head[2].trim();
    const bracket = /^[(（[]([^)）\]]*)[)）\]]\s*(.*)$/.exec(rest);
    if (bracket) {
      out.push({ hanzi, pinyin: toneMarks(bracket[1].trim()), meaning: clean(bracket[2]) });
      continue;
    }
    const columns = rest.split(/\t|\s*\|\s*|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (columns.length >= 2) {
      out.push({ hanzi, pinyin: toneMarks(columns[0]), meaning: clean(columns.slice(1).join(' ')) });
      continue;
    }
    // Take pinyin tokens until there is one syllable per character.
    const tokens = rest.split(/\s+/).filter(Boolean);
    const want = [...hanzi].filter((ch) => ch !== '·').length;
    let i = 0;
    let count = 0;
    while (i < tokens.length && count < want && (looksLikePinyin(tokens[i]) || isSyllable(tokens[i]))) {
      count += syllables(tokens[i]);
      i++;
    }
    out.push({ hanzi, pinyin: toneMarks(tokens.slice(0, i).join(' ')), meaning: clean(tokens.slice(i).join(' ')) });
  }
  return out;
}

function clean(value: string) {
  return value.replace(/^[-–—:：,，;；]\s*/, '').trim();
}

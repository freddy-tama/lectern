// Word counts that also work for Chinese and Japanese, which don't put spaces
// between words. Speakers say about 250 such characters a minute against about
// 130 English words, so each character counts as roughly half a word.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const CHAR_AS_WORD = 130 / 250;

export function cjkChars(text: string): number {
  return (text.match(CJK) ?? []).length;
}

/** Words in mixed text, with CJK characters weighted to speaking time. */
export function countWords(text: string): number {
  const chars = cjkChars(text);
  const rest = text.replace(CJK, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.round(rest + chars * CHAR_AS_WORD);
}

/** "48 words" or, for mostly-CJK text, "120 characters". */
export function lengthLabel(text: string): string {
  const chars = cjkChars(text);
  const latin = text.replace(CJK, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (chars > latin) return `${chars} character${chars === 1 ? '' : 's'}`;
  return `${latin} word${latin === 1 ? '' : 's'}`;
}

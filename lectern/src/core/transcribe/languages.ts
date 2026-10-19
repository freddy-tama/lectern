// Spoken languages the multilingual speech model knows, by ISO 639-1 code.

export const LANGUAGES: { code: string; name: string }[] = [
  ['af', 'Afrikaans'], ['ar', 'Arabic'], ['hy', 'Armenian'], ['az', 'Azerbaijani'], ['be', 'Belarusian'],
  ['bn', 'Bengali'], ['bs', 'Bosnian'], ['bg', 'Bulgarian'], ['ca', 'Catalan'], ['zh', 'Chinese'],
  ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'], ['en', 'English'],
  ['et', 'Estonian'], ['tl', 'Filipino'], ['fi', 'Finnish'], ['fr', 'French'], ['gl', 'Galician'],
  ['ka', 'Georgian'], ['de', 'German'], ['el', 'Greek'], ['gu', 'Gujarati'], ['ha', 'Hausa'],
  ['he', 'Hebrew'], ['hi', 'Hindi'], ['hu', 'Hungarian'], ['is', 'Icelandic'], ['id', 'Indonesian'],
  ['it', 'Italian'], ['ja', 'Japanese'], ['kn', 'Kannada'], ['kk', 'Kazakh'], ['km', 'Khmer'],
  ['ko', 'Korean'], ['lo', 'Lao'], ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['mk', 'Macedonian'],
  ['ms', 'Malay'], ['ml', 'Malayalam'], ['mt', 'Maltese'], ['mi', 'Maori'], ['mr', 'Marathi'],
  ['mn', 'Mongolian'], ['ne', 'Nepali'], ['no', 'Norwegian'], ['fa', 'Persian'], ['pl', 'Polish'],
  ['pt', 'Portuguese'], ['pa', 'Punjabi'], ['ro', 'Romanian'], ['ru', 'Russian'], ['sr', 'Serbian'],
  ['sk', 'Slovak'], ['sl', 'Slovenian'], ['so', 'Somali'], ['es', 'Spanish'], ['sw', 'Swahili'],
  ['sv', 'Swedish'], ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['tr', 'Turkish'],
  ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['uz', 'Uzbek'], ['vi', 'Vietnamese'], ['cy', 'Welsh'],
  ['yo', 'Yoruba'],
].map(([code, name]) => ({ code: code!, name: name! }));

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l.name]));

/** "English" for "en"; the code itself when unknown. */
export function languageName(code?: string): string {
  if (!code) return '';
  return BY_CODE.get(code) ?? code.toUpperCase();
}

/** The browser's language when the model knows it, else English. */
export function guessLanguage(locale = typeof navigator !== 'undefined' ? navigator.language : 'en'): string {
  const code = locale.toLowerCase().split(/[-_]/)[0] ?? 'en';
  return BY_CODE.has(code) ? code : 'en';
}

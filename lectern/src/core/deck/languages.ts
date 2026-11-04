// The languages a deck can be written in. The id is the language's English name, which the
// drafting AI reads; the label is the name in that language, as people look for it.

export interface DeckLanguage {
  id: string;
  label: string;
}

/** "" means the language of the brief and the files. */
export const DECK_LANGUAGES: DeckLanguage[] = [
  { id: '', label: 'Same as my files' },
  { id: 'English', label: 'English' },
  { id: 'Simplified Chinese', label: '中文（简体）' },
  { id: 'Traditional Chinese', label: '中文（繁體）' },
  { id: 'Indonesian', label: 'Bahasa Indonesia' },
  { id: 'Malay', label: 'Bahasa Melayu' },
  { id: 'Japanese', label: '日本語' },
  { id: 'Korean', label: '한국어' },
  { id: 'Vietnamese', label: 'Tiếng Việt' },
  { id: 'Thai', label: 'ไทย' },
  { id: 'Hindi', label: 'हिन्दी' },
  { id: 'Arabic', label: 'العربية' },
  { id: 'Spanish', label: 'Español' },
  { id: 'Portuguese', label: 'Português' },
  { id: 'French', label: 'Français' },
  { id: 'German', label: 'Deutsch' },
  { id: 'Italian', label: 'Italiano' },
  { id: 'Russian', label: 'Русский' },
  { id: 'Turkish', label: 'Türkçe' },
];

/** A saved choice that is still on the list, or "" for the files' language. */
export function deckLanguage(id: string | undefined): string {
  return DECK_LANGUAGES.some((l) => l.id === id) ? id! : '';
}

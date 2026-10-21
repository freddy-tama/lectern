// Links that open a sample deck in any view: /try/:sample/:view puts the sample back
// if it was deleted (never over someone's edits), then goes on to /:view/:deckId.

/** The sample decks a /try link can open, by the name used in the link. */
export const SAMPLES = {
  talk: 'deck_meetings_talk',
  report: 'deck_q3_update',
  lesson: 'deck_water_cycle',
  writing: 'deck_main_thing_first',
} as const;

export type SampleName = keyof typeof SAMPLES;

/** The views a sample opens in; each is also the first part of its app route. */
export const VIEWS = ['studio', 'present', 'presenter', 'prompter', 'study', 'print'] as const;

export type SampleView = (typeof VIEWS)[number];

/** The link to a sample deck in a view. `from` is the 0-based slide index present mode starts at. */
export const tryHref = (s: SampleName, v: SampleView = 'studio', from?: number): string =>
  `/try/${s}/${v}${from ? `?from=${from}` : ''}`;

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blankDeck, draftToDeck } from '../src/core/deck/draft';
import { wording } from '../src/core/deck/purpose';
import { PURPOSES, type DeckPurpose, deckPurpose } from '../src/core/deck/types';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { CORE_KINDS, registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

describe('deck purpose', () => {
  it('defaults by lesson link and ignores unknown values', () => {
    expect(deckPurpose({ lessonId: 'l1' })).toBe('lesson');
    expect(deckPurpose({})).toBe('talk');
    expect(deckPurpose({ purpose: 'pitch', lessonId: 'l1' })).toBe('pitch');
    expect(deckPurpose({ purpose: 'nonsense' as DeckPurpose })).toBe('talk');
  });

  it('has wording for every purpose, and lesson differs from talk', () => {
    for (const p of PURPOSES) {
      const w = wording(p.id);
      expect(w.keyPointsLabel).toBeTruthy();
      expect(w.aiRules.length).toBeGreaterThan(80);
    }
    expect(wording('lesson').keyPointsLabel).toBe('Key points for learners');
    expect(wording('talk').keyPointsLabel).toBe('Takeaways for the audience');
    expect(wording('lesson').studyName).toBe('Study mode');
    expect(wording('talk').studyName).toBe('Review mode');
    expect(wording('lesson').handoutAudience).toBe('Learners');
    expect(wording('talk').handoutAudience).toBe('Audience');
    expect(wording('pitch').checkLabel).not.toBe(wording('lesson').checkLabel);
    expect(wording('lesson').checkLabel).toBe('Check for understanding');
  });

  it('keeps the purpose when drafting or starting blank', () => {
    const base = { audience: 'adult' as const, themeId: 'paper' };
    const drafted = draftToDeck({ title: 'Q3', slides: [{ kind: 'title', content: { title: 'Q3' } }] }, { ...base, purpose: 'report' });
    expect(drafted.purpose).toBe('report');
    expect(blankDeck({ title: 'Seed round', ...base, purpose: 'pitch' }).purpose).toBe('pitch');
    expect(draftToDeck({ title: 'x', slides: [] }, base).purpose).toBeUndefined();
  });
});

describe('general wording in core kinds', () => {
  it('lays out the reworded examples with no warnings for all audiences and looks', () => {
    for (const k of CORE_KINDS.filter((x) => ['title', 'section', 'agenda', 'image', 'closing'].includes(x.kind))) {
      for (const audience of ['young', 'teen', 'adult'] as const) {
        for (const themeId of ['paper', 'chalk', 'campus', 'sunny', 'midnight', 'minimal']) {
          const slide = { id: 's', kind: k.kind, content: k.create(), notes: { script: '', keyPoints: [], cues: [], check: null, minutes: 1, links: [] } };
          const out = layoutSlide(slide, { theme: getTheme(themeId), audience, mode: 'show', slideNumber: 1, slideCount: 3, deckTitle: 'Deck' });
          // The quote's decorative opening mark is always flagged by the estimator.
          const warnings = out.warnings.filter((w) => w !== 'Text is too long to fit: ““”');
          expect(warnings, `${k.kind} ${audience} ${themeId}`).toEqual([]);
        }
      }
    }
  });
});

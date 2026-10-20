// @vitest-environment node
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeSlide } from '../src/core/deck/draft';
import { type Deck, emptyNotes } from '../src/core/deck/types';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { exportDeckToPptx, pictureCreditsText } from '../src/core/export/pptx';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

// 1 × 1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(() => registerCoreKinds());

describe('picture credits in PowerPoint', () => {
  it('lists the credited pictures of a slide once each', () => {
    const boxes = [
      { type: 'image' as const, id: 'a', src: 'asset:1', x: 0, y: 0, w: 1, h: 1, fit: 'cover' as const },
      { type: 'image' as const, id: 'b', src: 'asset:1', x: 0, y: 0, w: 1, h: 1, fit: 'cover' as const },
      { type: 'image' as const, id: 'c', src: 'asset:2', x: 0, y: 0, w: 1, h: 1, fit: 'cover' as const },
    ];
    expect(pictureCreditsText(boxes, { 'asset:1': 'Picture by Jo · CC BY 4.0' })).toBe('Picture credit\n• Picture by Jo · CC BY 4.0');
    expect(pictureCreditsText(boxes, { 'asset:1': 'One', 'asset:2': 'Two' })).toBe('Picture credits\n• One\n• Two');
    expect(pictureCreditsText(boxes, undefined)).toBe('');
  });

  it('puts the credit in the speaker notes of the slide that shows the picture', async () => {
    const deck: Deck = {
      id: 'd', title: 'Rain', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0,
      slides: [
        { id: 's1', kind: 'image', content: { title: 'Clouds', body: '', image: PNG, caption: '' }, notes: emptyNotes({ script: 'Look up.' }) },
        { id: 's2', kind: 'bullets', content: { title: 'No picture', bullets: ['x'], image: '' }, notes: emptyNotes() },
      ],
    };
    const { data, warnings } = await exportDeckToPptx(deck, { output: 'nodebuffer', credits: { [PNG]: '“Clouds” by Ana & Bo · CC BY 2.0 · https://e.org/p' } });
    expect(warnings).toEqual([]);
    const zip = await JSZip.loadAsync(data as Uint8Array);
    const notes = await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string');
    expect(notes).toContain('Look up.');
    expect(notes).toContain('Picture credit');
    expect(notes).toContain('“Clouds” by Ana &amp; Bo · CC BY 2.0 · https://e.org/p');
    const second = await zip.file('ppt/notesSlides/notesSlide2.xml')!.async('string');
    expect(second).not.toContain('Picture credit');
  });
});

describe('the credits slide', () => {
  const deck = (lines: string[]): Deck => ({
    id: 'd', title: 'T', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0,
    slides: [makeSlide('credits', { lines })],
  });

  it('shows each credit in small type in one column, two when there are many', () => {
    const few = layoutSlide(deck(['Slide 2: Picture by Jo · CC BY 4.0', 'Slide 3: Picture by Al']).slides[0], { target: 'pptx', mode: 'show', deckTitle: 'T', theme: getTheme('paper'), audience: 'adult' });
    const lines = few.boxes.filter((b) => b.type === 'text' && b.id.startsWith('line-'));
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((b) => b.x)).size).toBe(1);
    const many = layoutSlide(deck(Array.from({ length: 12 }, (_, i) => `Slide ${i + 2}: “Picture ${i}” by Someone · CC BY-SA 4.0 · https://commons.wikimedia.org/wiki/File:${i}.jpg`)).slides[0], { target: 'pptx', mode: 'show', deckTitle: 'T', theme: getTheme('paper'), audience: 'adult' });
    const cols = new Set(many.boxes.filter((b) => b.type === 'text' && b.id.startsWith('line-')).map((b) => b.x));
    expect(cols.size).toBe(2);
    expect(many.warnings).toEqual([]);
  });
});

// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { autoVariants } from '../src/core/deck/auto-style';
import { draftToDeck } from '../src/core/deck/draft';
import {
  MAX_PHOTO_NOTE, PHOTO_NOTE_SRC, cleanPhotoNote, openPhotoNote, photoNoteLine, photoNoteSearch, photosToAdd, settlePhotoNotes, withPhotoNoteFrame,
} from '../src/core/deck/photo-notes';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import type { ShapeBox, TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import type { DeckDraft } from '../src/core/plugins/api';
import type { JobDeck, PlannedSlide } from '../src/data/draft-jobs';
import { photoChoice } from '../src/data/profile';
import { jobDraft } from '../src/features/autodeck/drafting';
import { type PhotoDeps, addFoundPhotos } from '../src/features/autodeck/photos';

registerCoreKinds();

const NOTE = 'Wide shot of a Chinese class at a secondary school in Surabaya, students at their desks';

const slide = (id: string, kind: string, content: Record<string, unknown>, extra: Partial<Slide> = {}): Slide => ({
  id, kind, content, notes: emptyNotes({ script: 'Say this.' }), ...extra,
});

const deckOf = (slides: Slide[]): Deck => ({ id: 'd', title: 'Chinese in Indonesia', themeId: 'paper', audience: 'adult', slides, createdAt: 0, updatedAt: 0 });

const layout = (s: Slide, o: { mode?: 'edit' | 'show'; target?: 'web' | 'pptx' } = {}) =>
  layoutSlide(s, { theme: getTheme('paper'), audience: 'adult', ...o });

describe('photo notes', () => {
  it('are open while the picture field is empty, and settle once a picture is in', () => {
    const waiting = slide('s1', 'image', { title: 'A class', image: '' }, { photoNote: `  ${NOTE}  ` });
    expect(openPhotoNote(waiting)).toBe(NOTE);
    expect(withPhotoNoteFrame(waiting).image).toBe(PHOTO_NOTE_SRC);
    expect(photoNoteLine(waiting)).toBe(`Photo to add: ${NOTE}`);

    const placed = { ...waiting, content: { ...waiting.content, image: 'asset:p1' } };
    expect(openPhotoNote(placed)).toBe('');
    expect(withPhotoNoteFrame(placed).image).toBe('asset:p1');
    expect(photoNoteLine(placed)).toBe('');

    // A type with no picture field has nowhere for the photo.
    expect(openPhotoNote(slide('s2', 'chart', { title: 'Learners' }, { photoNote: NOTE }))).toBe('');

    const deck = deckOf([waiting, placed, slide('s3', 'text', { title: 'Plain' })]);
    const settled = settlePhotoNotes(deck);
    expect(settled.slides[0]).toBe(deck.slides[0]);
    expect(settled.slides[1]).not.toHaveProperty('photoNote');
    expect(settlePhotoNotes(settled)).toBe(settled);
    // An emptied note goes too.
    expect(settlePhotoNotes(deckOf([{ ...waiting, photoNote: ' ' }])).slides[0]).not.toHaveProperty('photoNote');
  });

  it('lists the photos to add on the slides that are shown, numbered by their place in the deck', () => {
    const deck = deckOf([
      slide('s1', 'title', { title: 'Chinese in Indonesia', image: '' }, { photoNote: 'Surabaya skyline at dusk' }),
      slide('s2', 'text', { title: 'Plain' }),
      slide('s3', 'bullets', { title: 'Schools', bullets: ['A', 'B'], image: '' }, { photoNote: NOTE }),
      slide('s4', 'image', { title: 'Hidden', image: '' }, { photoNote: 'Not shown', hidden: true }),
      slide('s5', 'image', { title: 'Done', image: 'asset:x' }, { photoNote: 'Already in' }),
    ]);
    expect(photosToAdd(deck)).toEqual([
      { slideId: 's1', number: 1, field: 'image', note: 'Surabaya skyline at dusk' },
      { slideId: 's3', number: 3, field: 'image', note: NOTE },
    ]);
  });

  it('cleans notes to one line and makes a picture search from them', () => {
    expect(cleanPhotoNote('A class\n\nat work ')).toBe('A class at work');
    expect(cleanPhotoNote('x'.repeat(400))).toHaveLength(MAX_PHOTO_NOTE);
    expect(cleanPhotoNote(42)).toBe('');
    expect(photoNoteSearch(NOTE)).toBe('a Chinese class at a secondary school in Surabaya');
    expect(photoNoteSearch('Close-up of a hand writing characters')).toBe('a hand writing characters');
    expect(photoNoteSearch('泗水一所中学的华文课，学生在写汉字')).toBe('泗水一所中学的华文课');
  });

  it('draws a labelled frame in the photo’s place while editing and in PowerPoint, and nothing when presenting', () => {
    const s = slide('s1', 'image', { title: 'A class', body: '', image: '', caption: '' }, { photoNote: NOTE });
    for (const o of [{ mode: 'edit' as const }, { target: 'pptx' as const, mode: 'show' as const }]) {
      const boxes = layout(s, o).boxes;
      expect(boxes.some((b) => b.type === 'image' && b.src === PHOTO_NOTE_SRC)).toBe(false);
      const frame = boxes.find((b): b is ShapeBox => b.type === 'shape' && b.id === 'image')!;
      expect(frame).toBeDefined();
      expect(frame.dash).toBe(true);
      expect(frame.bind).toBe('image');
      const words = boxes.filter((b): b is TextBox => b.type === 'text' && b.moveWith === 'image').map((b) => b.text);
      expect(words).toEqual(['Photo to add', NOTE]);
      expect(layout(s, o).warnings.join(' ')).not.toContain('too long');
    }
    const shown = layout(s).boxes;
    expect(shown.some((b) => b.id === 'image' || b.moveWith === 'image')).toBe(false);
    // With the photo in, the slide shows it as usual.
    const placed = layout({ ...s, content: { ...s.content, image: 'data:image/png;base64,AAAA' } }, { mode: 'edit' }).boxes;
    expect(placed.find((b) => b.id === 'image')?.type).toBe('image');
    expect(placed.some((b) => b.type === 'text' && b.text === 'Photo to add')).toBe(false);
  });

  it('keeps a frame for the photo on slides that show a picture only when they have one', () => {
    // Points with no picture take the whole width; with a photo to add they leave it room.
    const points = slide('s1', 'bullets', { title: 'Schools', bullets: ['One', 'Two'], reveal: false, image: '' }, { photoNote: NOTE, variant: 'right' });
    const frame = layout(points, { mode: 'edit' }).boxes.find((b) => b.id === 'image');
    expect(frame?.type).toBe('shape');
    expect(frame!.x).toBeGreaterThan(960);
    // Auto style counts the photo still to add, so a title slide keeps the layout that shows a picture.
    const deck = autoVariants({ ...deckOf([slide('t', 'title', { title: 'Chinese in Indonesia', image: '' }, { photoNote: 'Surabaya skyline' })]), autoStyle: true });
    expect(deck.slides[0]!.variant).toBe('left');
    expect(layout(deck.slides[0]!, { mode: 'edit' }).boxes.some((b) => b.type === 'text' && b.text === 'Photo to add')).toBe(true);
  });

  it('exports a labelled box and a speaker-notes line for each photo still to add', async () => {
    const deck = deckOf([
      slide('s1', 'image', { title: 'A class', body: '', image: '', caption: '' }, { photoNote: NOTE }),
      slide('s2', 'image', { title: 'Done', body: '', image: '', caption: '' }),
    ]);
    const out = await exportDeckToPptx(deck, { output: 'nodebuffer' });
    const zip = await JSZip.loadAsync(out.data as Uint8Array);
    const first = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(first).toContain('PHOTO TO ADD');
    expect(first).toContain('Surabaya');
    expect(first).toContain('prstDash');
    const second = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(second).not.toContain('PHOTO TO ADD');
    const notes = await Promise.all(Object.keys(zip.files).filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p)).sort().map((p) => zip.file(p)!.async('string')));
    expect(notes.join(' ')).toContain('Photo to add: Wide shot of a Chinese class');
    expect(out.warnings).toEqual([]);
  });
});

describe('photo notes in drafting', () => {
  const plan = (o: Partial<PlannedSlide>): PlannedSlide => ({ id: 'o', title: 'T', kind: 'image', minutes: 1, point: 'p', pictures: [], ...o });

  it('carry the outline’s photo note to the slide, and only where the photo field is empty', () => {
    const deck: JobDeck = {
      key: 'k', title: 'Chinese in Indonesia', batches: [], slides: [{ number: 1, kind: 'image', content: { title: 'A class', image: '' }, notes: {} }],
      outline: [plan({ photo: NOTE }), plan({ kind: 'bullets', title: 'Not written yet', photo: 'Students at a Chinese New Year show' })],
    };
    const draft = jobDraft({ request: { minutes: 10 } as never }, deck);
    expect(draft.slides.map((s) => s.photoNote)).toEqual([NOTE, 'Students at a Chinese New Year show']);
    const made = draftToDeck(draft, { audience: 'adult', themeId: 'paper' });
    expect(made.slides.map((s) => s.photoNote)).toEqual([NOTE, 'Students at a Chinese New Year show']);
    // A picture already in its place, or a slide type without one, keeps no note.
    const filled = draftToDeck({ title: 'T', slides: [
      { kind: 'image', content: { image: 'asset:mine' }, photoNote: 'x' },
      { kind: 'chart', content: { title: 'Learners' }, photoNote: 'y' },
    ] }, { audience: 'adult', themeId: 'paper' });
    expect(filled.slides.map((s) => s.photoNote)).toEqual([undefined, undefined]);
  });

  it('leave a note of the search when no free photo is found', async () => {
    const draft: DeckDraft = { title: 'T', slides: [{ kind: 'image', content: { title: 'A', image: '' } }, { kind: 'image', content: { title: 'B', image: '' } }] };
    const outline = [{ search: 'Surabaya school' }, { search: 'Jakarta street' }];
    const none: PhotoDeps = { providers: async () => [], search: async () => [], keep: async () => 'asset:x' };
    const offline = await addFoundPhotos(draft, outline, { deps: none });
    expect(offline.draft.slides.map((s) => s.photoNote)).toEqual(['Surabaya school', 'Jakarta street']);
    const empty: PhotoDeps = { ...none, providers: async () => ['openverse'] };
    const missed = await addFoundPhotos(draft, outline, { deps: empty });
    expect(missed.added).toBe(0);
    expect(missed.draft.slides.map((s) => s.photoNote)).toEqual(['Surabaya school', 'Jakarta street']);
  });

  it('read the photo choice from older profiles too', () => {
    expect(photoChoice({})).toBe('none');
    expect(photoChoice({ findPictures: true })).toBe('find');
    expect(photoChoice({ photos: 'notes', findPictures: true })).toBe('notes');
    expect(photoChoice({ photos: 'none', findPictures: true })).toBe('none');
  });
});

import { describe, expect, it } from 'vitest';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { buildMaterial, fallbackTopic, hasMaterial, kindOf, offlineDraft, picturesOf, placePictures } from '../src/features/autodeck/make';

registerCoreKinds();

const file = (name: string, type = '') => new File(['x'], name, { type });

describe('deck maker', () => {
  it('sorts drops into documents, recordings and pictures', () => {
    expect(kindOf(file('talk.m4a', 'audio/mp4'))).toBe('audio');
    expect(kindOf(file('lecture.mp4'))).toBe('audio');
    expect(kindOf(file('chart.PNG'))).toBe('picture');
    expect(kindOf(file('report.pdf', 'application/pdf'))).toBe('doc');
  });

  it('labels each file and gives every file a fair share of the budget', () => {
    const long = 'word '.repeat(5000);
    const out = buildMaterial([
      { file: file('big.pdf'), kind: 'doc', text: long },
      { file: file('short.md'), kind: 'doc', text: 'A short brief.' },
      { file: file('call.mp3'), kind: 'audio', text: 'We agreed to ship in May.' },
      { file: file('photo.jpg'), kind: 'picture', text: '' },
    ], 3000);
    expect(out).toContain('=== short.md (document) ===\nA short brief.');
    expect(out).toContain('=== call.mp3 (transcript of a recording) ===\nWe agreed to ship in May.');
    expect(out).toContain('[…cut for length]');
    expect(out).not.toContain('photo.jpg');
    expect(out.length).toBeLessThan(3200);
  });

  it('names the files when the person wrote no brief', () => {
    expect(fallbackTopic([{ file: file('q3_results.xlsx'), kind: 'doc' }])).toBe('A deck based on “q3 results”.');
  });

  it('counts only files with text or pictures as something to build an offline deck from', () => {
    expect(hasMaterial([])).toBe(false);
    expect(hasMaterial([{ kind: 'doc', text: '  \n ', pictures: [] }])).toBe(false);
    expect(hasMaterial([{ kind: 'audio', text: '', pictures: [] }])).toBe(false);
    expect(hasMaterial([{ kind: 'doc', text: '# Plan', pictures: [] }])).toBe(true);
    expect(hasMaterial([{ kind: 'audio', text: 'We are on track.', pictures: [] }])).toBe(true);
    expect(hasMaterial([{ kind: 'doc', text: '', pictures: [file('scan.png')] }])).toBe(true);
    expect(hasMaterial([{ kind: 'picture', text: '', pictures: [file('team.jpg')] }])).toBe(true);
  });

  it('builds an offline deck from several files, one section each, with a gallery of pictures', () => {
    const draft = offlineDraft([
      { file: file('plan.md'), kind: 'doc', text: '# The plan\n\n## Goals\n- Grow\n- Hire', pictures: [file('a.png'), file('b.png')] },
      { file: file('standup.mp3'), kind: 'audio', text: 'We are on track for the launch.', pictures: [] },
    ], 'Launch update');
    expect(draft.title).toBe('The plan');
    expect(draft.slides[0]!.kind).toBe('title');
    expect(draft.slides.some((s) => s.content.title === 'standup')).toBe(true);
    const gallery = draft.slides.find((s) => s.kind === 'gallery');
    expect(gallery?.content.images).toEqual([{ image: 'pic1', caption: '' }, { image: 'pic2', caption: '' }]);
  });

  it('puts a single picture on the title slide, and titles a deck of recordings from the fallback', () => {
    const draft = offlineDraft([
      { file: file('call.mp3'), kind: 'audio', text: 'We are on track.', pictures: [] },
      { file: file('team.jpg'), kind: 'picture', text: '', pictures: [file('team.jpg')] },
    ], 'Weekly call');
    expect(draft.title).toBe('Weekly call');
    expect(draft.slides[0]!.content.image).toBe('pic1');
  });

  it('numbers the pictures with what each is for, and leaves pages to read off an offline deck', () => {
    const marked = picturesOf([
      { pictures: [file('page1.png'), file('page2.png')], pictureRole: 'read' },
      { pictures: [file('team.jpg')] },
      { pictures: [file('logo.png')], pictureRole: 'show' },
    ]);
    expect(marked.map((p) => [p.file.name, p.role])).toEqual([['page1.png', 'read'], ['page2.png', 'read'], ['team.jpg', 'auto'], ['logo.png', 'show']]);
    expect(picturesOf([{ pictures: Array.from({ length: 10 }, (_, i) => file(`p${i}.png`)) }])).toHaveLength(8);
    const draft = offlineDraft([
      { file: file('book.pdf'), kind: 'doc', text: '# Chapter one\n\n## Rivers\n- Long\n- Wet', pictures: [file('page1.png'), file('page2.png')], pictureRole: 'read' },
      { file: file('team.jpg'), kind: 'picture', text: '', pictures: [file('team.jpg')] },
    ], 'Notes');
    // Only the team photo counts: it is pic1, and no gallery is made of the book's pages.
    expect(draft.slides[0]!.content.image).toBe('pic1');
    expect(draft.slides.some((s) => s.kind === 'gallery')).toBe(false);
  });

  it('places pictures by id, saves each once and clears unknown ids', async () => {
    const saved: string[] = [];
    const save = async (f: File) => { saved.push(f.name); return `asset:${f.name}`; };
    const out = await placePictures({
      title: 'T',
      slides: [
        { kind: 'image', content: { title: 'Look', image: 'pic2' } },
        { kind: 'bullets', content: { title: 'Points', bullets: ['pic1 is not a field'], image: 'pic9' } },
        { kind: 'gallery', content: { images: [{ image: 'pic2', caption: 'Again' }, { image: 'pic1', caption: '' }] } },
      ],
    }, [file('one.png'), file('two.png')], save);
    expect(out.slides[0]!.content.image).toBe('asset:two.png');
    expect(out.slides[1]!.content.image).toBe('');
    expect(out.slides[1]!.content.bullets).toEqual(['pic1 is not a field']);
    expect(out.slides[2]!.content.images).toEqual([{ image: 'asset:two.png', caption: 'Again' }, { image: 'asset:one.png', caption: '' }]);
    expect(saved.sort()).toEqual(['one.png', 'two.png']);
  });
});

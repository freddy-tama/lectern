// @vitest-environment node
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { exportDeckToPptx, keyNotesText } from '../src/core/export/pptx';

// 1 × 1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const slide = (id: string, kind: string, content: Record<string, unknown>, script = ''): Slide => ({
  id, kind, content, notes: emptyNotes({ script }),
});

function makeDeck(): Deck {
  return {
    id: 'd1',
    title: 'Water: the <basics>?',
    themeId: 'paper',
    audience: 'teen',
    createdAt: 0,
    updatedAt: 0,
    slides: [
      slide('s1', 'title', { eyebrow: 'Week 3', title: 'The water cycle', subtitle: 'Where rain comes from', presenter: 'Ms Lee', image: '' }, 'Welcome everyone & settle in.'),
      slide('s2', 'bullets', { title: 'Three stages', bullets: ['Evaporation', 'Condensation', 'Precipitation'], reveal: true, image: '' }, 'Walk through each stage.'),
      slide('s3', 'question', { question: 'Which stage forms clouds?', options: ['Evaporation', 'Condensation', 'Precipitation', 'Runoff'], correct: 1, answer: 'Condensation turns vapour into droplets.' }, 'Ask, then reveal.'),
      slide('s4', 'recall', { title: 'Quick recall', cards: [{ prompt: 'Rain is…', answer: 'Precipitation' }, { prompt: 'Vapour rises by…', answer: 'Evaporation' }] }),
      slide('s5', 'steps', { title: 'How it works', steps: [{ label: 'Heat', detail: 'Sun warms water' }, { label: 'Rise', detail: '' }, { label: 'Cool', detail: '' }], reveal: true }),
      slide('s6', 'summary', { title: 'Takeaways', points: ['Water moves in a cycle', 'The sun drives it'] }),
      slide('s7', 'image', { title: 'A cloud', body: 'What do you see?', image: PNG, caption: 'Photo: test' }, 'Describe the picture.'),
      { ...slide('s8', 'bullets', { title: 'Hidden', bullets: ['x'], reveal: false, image: '' }), hidden: true },
    ],
  };
}

// jsdom ships no type declarations here, so load it by name and describe the one thing used.
type XmlDoc = { getElementsByTagName(name: string): { length: number } };
let parser: { parseFromString(xml: string, type: string): XmlDoc };
beforeAll(async () => {
  const name = 'jsdom';
  const { JSDOM } = (await import(/* @vite-ignore */ name)) as { JSDOM: new (html: string) => { window: { DOMParser: new () => typeof parser } } };
  parser = new (new JSDOM('').window.DOMParser)();
});

function assertWellFormed(name: string, xml: string) {
  const doc = parser.parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror').length, `${name} is not well-formed`).toBe(0);
}

async function load(data: Blob | Uint8Array) {
  expect(data instanceof Uint8Array).toBe(true);
  return JSZip.loadAsync(data as Uint8Array);
}

const slideFiles = (zip: JSZip) =>
  Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));

describe('keyNotesText', () => {
  it('formats every section and omits empty ones', () => {
    const text = keyNotesText(emptyNotes({
      script: 'Say this.', keyPoints: ['One', 'Two'], cues: ['Pause', 'Ask the room'],
      check: { question: 'Why?', answer: 'Because.' }, minutes: 3, links: [{ label: 'Docs', url: 'https://example.com' }],
    }));
    expect(text).toBe('Say this.\n\nKey points\n• One\n• Two\n\nCues: Pause · Ask the room\nCheck: Why? — Because.\nAbout 3 min\nLinks: Docs — https://example.com');
    expect(keyNotesText(emptyNotes({ minutes: 0 }))).toBe('');
    expect(keyNotesText(emptyNotes({ script: 'Only this', minutes: 2 }))).toBe('Only this\n\nAbout 2 min');
  });
});

describe('exportDeckToPptx', () => {
  const deck = makeDeck();
  let animate: Awaited<ReturnType<typeof exportDeckToPptx>>;
  let build: Awaited<ReturnType<typeof exportDeckToPptx>>;
  let final: Awaited<ReturnType<typeof exportDeckToPptx>>;

  beforeAll(async () => {
    animate = await exportDeckToPptx(deck, { steps: 'animate', output: 'nodebuffer' });
    build = await exportDeckToPptx(deck, { steps: 'build', output: 'nodebuffer' });
    final = await exportDeckToPptx(deck, { steps: 'final', output: 'nodebuffer' });
  });

  it('names the file after the deck, filesystem-safe', () => {
    expect(animate.fileName).toBe('Water the basics.pptx');
  });

  it('writes one slide per visible slide in animate and final modes', async () => {
    expect(slideFiles(await load(animate.data))).toHaveLength(7);
    expect(slideFiles(await load(final.data))).toHaveLength(7);
  });

  it('expands slides with steps in build mode', async () => {
    const zip = await load(build.data);
    // bullets 3 steps -> 4, question 1 -> 2, recall 2 -> 3, steps 3 -> 4, others 1 each (title, summary, image)
    expect(slideFiles(zip)).toHaveLength(4 + 2 + 3 + 4 + 3);
    for (const path of slideFiles(zip)) expect(await zip.file(path)!.async('string')).not.toContain('<p:timing');
  });

  it('puts the script in the speaker notes', async () => {
    for (const result of [animate, build, final]) {
      const zip = await load(result.data);
      const notes = await Promise.all(Object.keys(zip.files).filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p)).map((p) => zip.file(p)!.async('string')));
      const joined = notes.join('\n');
      expect(joined).toContain('Welcome everyone &amp; settle in.');
      expect(joined).toContain('Walk through each stage.');
      expect(joined).toContain('About 2 min');
    }
    // build mode repeats the notes on every copy
    const zip = await load(build.data);
    const notes = await Promise.all(Object.keys(zip.files).filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p)).map((p) => zip.file(p)!.async('string')));
    expect(notes.filter((n) => n.includes('Walk through each stage.'))).toHaveLength(4);
  });

  it('can leave the notes out', async () => {
    const result = await exportDeckToPptx(deck, { steps: 'final', includeNotes: false, output: 'nodebuffer' });
    const zip = await load(result.data);
    const notes = await Promise.all(Object.keys(zip.files).filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p)).map((p) => zip.file(p)!.async('string')));
    expect(notes.join('')).not.toContain('Welcome everyone');
  });

  it('adds one on-click Appear per step in animate mode, pointing at the right shapes', async () => {
    const zip = await load(animate.data);
    const files = slideFiles(zip);
    // slide 2 is the bullets slide with revealed points (steps 1..3)
    const xml = await zip.file(files[1])!.async('string');
    expect(xml).toContain('<p:timing');
    expect(xml.match(/nodeType="clickEffect"/g)).toHaveLength(3);
    const shapeIds = (step: number) => [...xml.matchAll(new RegExp(`<p:cNvPr id="(\\d+)" name="s${step}-`, 'g'))].map((m) => m[1]);
    for (const step of [1, 2, 3]) {
      const ids = shapeIds(step);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(xml).toContain(`<p:spTgt spid="${id}"/>`);
    }
    // nothing visible from the start is animated
    const alwaysOn = shapeIds(0);
    expect(alwaysOn.length).toBeGreaterThan(0);
    for (const id of alwaysOn) expect(xml).not.toContain(`<p:spTgt spid="${id}"/>`);
    // clicks come in step order
    const order = [...xml.matchAll(/nodeType="clickEffect"[\s\S]*?<p:spTgt spid="(\d+)"/g)].map((m) => m[1]);
    expect(order).toEqual([shapeIds(1)[0], shapeIds(2)[0], shapeIds(3)[0]]);

    // slide 3 (question): answer shapes appear together on one click
    const q = await zip.file(files[2])!.async('string');
    expect(q.match(/nodeType="clickEffect"/g)).toHaveLength(1);
    expect(q.match(/nodeType="withEffect"/g)!.length).toBeGreaterThan(1);

    // a slide without steps has no timing
    const first = await zip.file(files[0])!.async('string');
    expect(first).not.toContain('<p:timing');
  });

  it('writes every part as well-formed XML', async () => {
    for (const result of [animate, build, final]) {
      const zip = await load(result.data);
      const xmlParts = Object.keys(zip.files).filter((p) => /\.(xml|rels)$/.test(p));
      expect(xmlParts.length).toBeGreaterThan(10);
      for (const path of xmlParts) assertWellFormed(path, await zip.file(path)!.async('string'));
    }
  });

  it('embeds the image and keeps notes paragraphs', async () => {
    const zip = await load(animate.data);
    expect(Object.keys(zip.files).some((p) => p.startsWith('ppt/media/'))).toBe(true);
    const files = slideFiles(zip);
    const img = await zip.file(files[6])!.async('string');
    expect(img).toContain('<p:pic>');
    const notes = await zip.file('ppt/notesSlides/notesSlide7.xml')!.async('string');
    expect(notes).toContain('Describe the picture.');
    expect(notes.match(/<a:p>/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('skips images it cannot load and says so', async () => {
    const d = makeDeck();
    d.slides = [slide('i1', 'image', { title: 'Remote', body: 'b', image: 'https://example.com/a.png', caption: '' })];
    const result = await exportDeckToPptx(d, { output: 'nodebuffer' });
    expect(result.warnings.join(' ')).toContain('image');
    const zip = await load(result.data);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).not.toContain('<p:pic>');
    const resolved = await exportDeckToPptx(d, { output: 'nodebuffer', resolveImage: async () => PNG });
    expect(await (await load(resolved.data)).file('ppt/slides/slide1.xml')!.async('string')).toContain('<p:pic>');
  });

  it('exports an empty deck without throwing', async () => {
    const result = await exportDeckToPptx({ ...makeDeck(), title: '  ', slides: [] }, { output: 'nodebuffer' });
    expect(result.fileName).toBe('Lesson.pptx');
    expect(slideFiles(await load(result.data))).toHaveLength(1);
  });
});

// Reading .pptx files the way real decks are built: blank layouts with loose text boxes,
// labels repeated on every slide, dialogues, worksheets, pictures with descriptions, charts,
// tables, hidden slides and slides moved around. Every file here is built in the test.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { outlineToDraft } from '../src/core/deck/outline';
import { findQuestion, finishedDeck, readPptx } from '../src/core/import/finished';
import { bankWords, findPractice } from '../src/core/import/practice';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

let ids = 10;
/** A text box at (x, y) inches, in type of `size` points, one paragraph per line. */
function box(text: string, o: { x?: number; y?: number; size?: number; ph?: string } = {}): string {
  const at = o.x === undefined ? '' : `<a:xfrm><a:off x="${Math.round(o.x * 914400)}" y="${Math.round((o.y ?? 0) * 914400)}"/><a:ext cx="7315200" cy="914400"/></a:xfrm>`;
  const runs = text.split('\n').map((l) => `<a:p><a:r><a:rPr lang="en-GB"${o.size ? ` sz="${o.size * 100}"` : ''}/><a:t>${l}</a:t></a:r></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${ids++}" name="Text ${ids}"/><p:cNvSpPr txBox="1"/><p:nvPr>${o.ph ? `<p:ph type="${o.ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:spPr>${at}</p:spPr><p:txBody><a:bodyPr/>${runs}</p:txBody></p:sp>`;
}

function slide(shapes: string, attrs = ''): string {
  return `<p:sld ${NS}${attrs}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;
}

/** A .pptx of these slides (slide1.xml, slide2.xml…), shown in `order` (indexes from 0). */
async function pptx(slides: string[], o: { order?: number[]; files?: Record<string, string> } = {}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const order = o.order ?? slides.map((_, i) => i);
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst>${order.map((i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`);
  slides.forEach((s, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, s));
  for (const [name, body] of Object.entries(o.files ?? {})) zip.file(name, body);
  return zip.generateAsync({ type: 'arraybuffer' });
}

const deckOf = (slides: Awaited<ReturnType<typeof readPptx>>['slides']) => finishedDeck(
  slides.map((s) => ({ picture: '', title: s.title, text: s.text, notes: s.notes, hidden: s.hidden })),
  { title: 'T', audience: 'adult', purpose: 'talk', themeId: 'midnight' },
);

describe('F1 · slide names on blank layouts', () => {
  const label = () => box('Unit 3 · Reading', { x: 0.3, y: 0.2, size: 12 });
  const deck = () => pptx([
    slide(label() + box('Plants and water', { x: 1, y: 2.5, size: 44 })),
    // File order: the label, a body line placed lower, the big heading, then the web address.
    slide(label() + box('Roots take in water from the soil.', { x: 1, y: 3.6, size: 20 }) + box('How plants drink', { x: 1, y: 2.2, size: 40 }) + box('www.example.org/plants', { x: 1, y: 6.6, size: 54 })),
    slide(label() + box('Leaves lose water as vapour.', { x: 1, y: 2, size: 24 })),
    slide(label() + box('Thank you', { x: 1, y: 2.5, size: 48 }) + box('https://example.org', { x: 1, y: 6.6, size: 14 })),
  ]);

  it('names a slide after its largest words, skipping the label on every slide and the web address', async () => {
    const { slides } = await readPptx(await deck());
    expect(slides.map((s) => s.title)).toEqual(['Plants and water', 'How plants drink', 'Leaves lose water as vapour.', 'Thank you']);
    expect(deckOf(slides).slides.map((s) => (s.content as { title: string }).title)).toEqual(['Plants and water', 'How plants drink', 'Leaves lose water as vapour.', 'Thank you']);
  });

  it('reads the boxes top to bottom and leaves the repeated label out of the words', async () => {
    const { slides } = await readPptx(await deck());
    expect(slides[1]!.text).toBe('How plants drink\nRoots take in water from the soil.\nwww.example.org/plants');
    expect(slides.every((s) => !s.text.includes('Unit 3'))).toBe(true);
  });

  it('keeps a title placeholder as the name, and a label that is not on most slides', async () => {
    const { slides } = await readPptx(await pptx([
      slide(box('Small note', { x: 0.3, y: 0.2, size: 12 }) + box('Big words here', { x: 1, y: 3, size: 60 }) + box('Agenda', { ph: 'title' })),
      slide(box('Small note', { x: 0.3, y: 0.2, size: 12 }) + box('Next', { x: 1, y: 3, size: 30 })),
      slide(box('Other', { x: 1, y: 3, size: 30 })),
    ]));
    expect(slides[0]!.title).toBe('Agenda');
    expect(slides[1]!.text).toContain('Small note');
  });
});

describe('F2 · a dialogue is not a question', () => {
  it('asks nothing of a statement followed by lines spoken by A and B', async () => {
    const { slides } = await readPptx(await pptx([
      slide(box('Ask before you act.', { x: 1, y: 1, size: 32 }) + box("A: Let's cross the river!\nB: Stop, it is too deep!", { x: 1, y: 3, size: 24 })),
    ]));
    expect(findQuestion(slides[0]!.text)).toBeNull();
    expect((deckOf(slides).slides[0]!.content as { question: string }).question).toBe('');
  });

  it('still finds choices after a question, with any separator', () => {
    expect(findQuestion('Who is speaking?\nA: the horse\nB: the squirrel')).toMatchObject({ question: 'Who is speaking?', options: ['the horse', 'the squirrel'] });
    expect(findQuestion('“河”是什么意思？\nA：river\nB：mountain')).toMatchObject({ options: ['river', 'mountain'] });
    expect(findQuestion('Pick one\nA. Run!\nB. Hide!')).toBeNull();
    expect(findQuestion('Pick one\na) red\nb) blue')).toMatchObject({ options: ['red', 'blue'] });
  });
});

describe('F3 · worksheet practice', () => {
  const judged = 'The Sun is a star. （√）\nThe Moon makes its own light. （×，it reflects sunlight）\n3. Water boils at 100 °C at sea level. (✓)';

  it('reads statements marked √ or × as statements to judge, with the correction', async () => {
    const { slides } = await readPptx(await pptx([slide(box('Right or wrong', { x: 1, y: 0.5, size: 36 }) + box(judged, { x: 1, y: 2, size: 24 }))]));
    expect(findQuestion(slides[0]!.text)).toBeNull();
    expect(findPractice(slides[0]!.text)).toEqual({ kind: 'true-false', items: [
      { statement: 'The Sun is a star.', isTrue: true, correction: '' },
      { statement: 'The Moon makes its own light.', isTrue: false, correction: 'it reflects sunlight' },
      { statement: 'Water boils at 100 °C at sea level.', isTrue: true, correction: '' },
    ] });
    const draft = outlineToDraft(`# Water\n\n## Right or wrong\n${judged.split('\n').map((l) => `- ${l}`).join('\n')}`);
    expect(draft.slides[1]).toMatchObject({ kind: 'true-false', content: { title: 'Right or wrong', items: [{ isTrue: true }, { isTrue: false, correction: 'it reflects sunlight' }, { isTrue: true }] } });
  });

  it('reads empty brackets or an underline beside a word bank as a passage to fill', () => {
    const text = '小鸟在树上（　）。\n小猫在河边（ ）鱼。\n词语：唱歌、钓';
    expect(findPractice(text)).toEqual({ kind: 'fill-in', passage: '小鸟在树上[ ]。 小猫在河边[ ]鱼。', bank: ['唱歌', '钓'] });
    const draft = outlineToDraft('# Plants\n\n## Complete it\nPlants need ____ and light to grow.\nWord bank: water, salt, sand');
    expect(draft.slides[1]).toMatchObject({ kind: 'fill-in', content: { title: 'Complete it', passage: 'Plants need [ ] and light to grow.', bank: ['water', 'salt', 'sand'] } });
  });

  it('needs a real bank line: a sentence beside a blank is not one', () => {
    expect(findPractice('Plants need ____ to grow.\nThey also need light.')).toBeNull();
    expect(bankWords('rain, snow, hail')).toEqual(['rain', 'snow', 'hail']);
    expect(bankWords('The cat sat on the mat')).toBeNull();
    expect(bankWords('高兴  难过  害怕')).toEqual(['高兴', '难过', '害怕']);
  });

  it('leaves numbered notes (①…④) alone', async () => {
    const passage = '小明走进公园①，看见一只小鸟②。\n小鸟飞到树上③，唱起了歌④。\n① 走进：进入。\n② 看见：看到。\n③ 飞：鸟在空中动。\n④ 唱：发出声音。';
    const { slides } = await readPptx(await pptx([slide(box(passage, { x: 1, y: 1, size: 24 }))]));
    expect(findQuestion(slides[0]!.text)).toBeNull();
    expect(findPractice(slides[0]!.text)).toBeNull();
    const kinds = outlineToDraft(`# 公园\n\n## 读一读\n${passage}`).slides.map((s) => s.kind);
    expect(kinds).not.toContain('question');
    expect(kinds).not.toContain('true-false');
    expect(kinds).not.toContain('fill-in');
  });
});

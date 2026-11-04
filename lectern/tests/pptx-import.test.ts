// Reading .pptx files the way real decks are built: blank layouts with loose text boxes,
// labels repeated on every slide, dialogues, worksheets, pictures with descriptions, charts,
// tables, hidden slides and slides moved around. Every file here is built in the test.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { finishedDeck, readPptx } from '../src/core/import/finished';

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

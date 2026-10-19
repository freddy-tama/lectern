// Reads a dropped file into outline text that outlineToDraft understands.
// Word headings become "##", list paragraphs become "-", and PowerPoint slides
// keep their titles, points and speaker notes.


/** JSZip loads only when someone opens a Word or PowerPoint file. */
async function loadZip(buffer: ArrayBuffer) {
  const { default: JSZip } = await import('jszip');
  return JSZip.loadAsync(buffer);
}

export const OUTLINE_ACCEPT = '.txt,.md,.markdown,.docx,.pptx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

async function docxToOutline(buffer: ArrayBuffer): Promise<string> {
  const zip = await loadZip(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This Word file has no readable text.');
  const doc = parse(xml);
  const lines: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    const text = Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('').trim();
    if (!text) { lines.push(''); continue; }
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttribute('w:val') ?? '';
    const isList = p.getElementsByTagNameNS(W, 'numPr').length > 0 || /list/i.test(style);
    if (/^title$/i.test(style) || /heading ?1$/i.test(style)) lines.push(`# ${text}`);
    else if (/heading ?[2-4]$/i.test(style)) lines.push(`## ${text}`);
    else if (isList) lines.push(`- ${text}`);
    else lines.push(text);
  }
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // A document with one "Heading 1" per section reads better with sections as slides.
  const h1 = (out.match(/^# /gm) ?? []).length;
  return h1 > 1 ? out.replace(/^# /gm, '## ').replace(/^## /, '# ') : out;
}

function shapeTexts(doc: Document) {
  const shapes = Array.from(doc.getElementsByTagNameNS(P, 'sp'));
  return shapes.map((sp) => {
    const ph = sp.getElementsByTagNameNS(P, 'ph')[0];
    const type = ph?.getAttribute('type') ?? '';
    const paras = Array.from(sp.getElementsByTagNameNS(A, 'p'))
      .map((p) => Array.from(p.getElementsByTagNameNS(A, 't')).map((t) => t.textContent ?? '').join('').trim())
      .filter(Boolean);
    return { type, paras };
  });
}

async function pptxToOutline(buffer: ArrayBuffer): Promise<string> {
  const zip = await loadZip(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  if (!slideFiles.length) throw new Error('This PowerPoint file has no slides.');
  const out: string[] = [];
  for (const [i, name] of slideFiles.entries()) {
    const doc = parse(await zip.file(name)!.async('string'));
    const shapes = shapeTexts(doc);
    const titleShape = shapes.find((s) => s.type === 'title' || s.type === 'ctrTitle');
    const title = titleShape?.paras.join(' ') ?? '';
    const body = shapes.filter((s) => s !== titleShape && s.type !== 'sldNum' && s.type !== 'dt' && s.type !== 'ftr').flatMap((s) => s.paras);
    const relsName = name.replace('slides/', 'slides/_rels/') + '.rels';
    const rels = await zip.file(relsName)?.async('string');
    const notesTarget = rels ? /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1] : undefined;
    let notes = '';
    if (notesTarget) {
      const nd = parse(await zip.file(`ppt/notesSlides/${notesTarget}`)!.async('string'));
      notes = shapeTexts(nd).filter((s) => s.type === 'body').flatMap((s) => s.paras).join(' ');
    }
    if (i === 0) {
      out.push(`# ${title || body[0] || 'Imported deck'}`);
      if (body.length) out.push(body.filter((b) => b !== title).slice(0, 1).join(''));
      if (notes) out.push('', `Notes: ${notes}`);
      out.push('');
      continue;
    }
    out.push(`## ${title || body.shift() || `Slide ${i + 1}`}`);
    out.push(...body.map((b) => `- ${b}`));
    if (notes) out.push(`Notes: ${notes}`);
    out.push('');
  }
  return out.join('\n').trim();
}

export async function fileToOutline(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.size > 25 * 1024 * 1024) throw new Error('This file is over 25 MB. Choose a smaller file.');
  if (name.endsWith('.docx')) return docxToOutline(await file.arrayBuffer());
  if (name.endsWith('.pptx')) return pptxToOutline(await file.arrayBuffer());
  if (/\.(txt|md|markdown)$/.test(name) || file.type.startsWith('text/')) return (await file.text()).trim();
  if (name.endsWith('.pdf')) throw new Error('PDFs aren’t read yet. Copy the text from the PDF and paste it here.');
  throw new Error('This file type isn’t supported. Use a Word, PowerPoint, Markdown or text file.');
}

// Reads a dropped file into outline text that outlineToDraft understands.
// Word headings become "##", list paragraphs become "-", and PowerPoint slides
// keep their titles, points and speaker notes. PDFs, spreadsheets, web pages,
// OpenDocument files, e-books and subtitle transcripts are read the same way.
// The heavy readers (JSZip, PDF.js) load only when someone opens such a file.

/** JSZip loads only when someone opens a zipped document (Word, PowerPoint, Excel, OpenDocument, EPUB). */
async function loadZip(buffer: ArrayBuffer) {
  const { default: JSZip } = await import('jszip');
  return JSZip.loadAsync(buffer);
}

/** Every document type Lectern reads. Audio and pictures are handled by the deck maker. */
export const OUTLINE_ACCEPT = '.txt,.md,.markdown,.docx,.pptx,.pdf,.xlsx,.csv,.tsv,.html,.htm,.rtf,.odt,.odp,.ods,.epub,.srt,.vtt,.json';

const DOC_EXT = /\.(txt|md|markdown|docx|pptx|pdf|xlsx|csv|tsv|html?|rtf|odt|odp|ods|epub|srt|vtt|json)$/i;

/** Formats people often try that a browser can't read, with what to do instead. */
const SAVE_AS: Record<string, string> = {
  doc: 'This is an older Word file. Open it in Word, save it as .docx, then try again.',
  ppt: 'This is an older PowerPoint file. Open it in PowerPoint, save it as .pptx, then try again.',
  xls: 'This is an older Excel file. Open it in Excel, save it as .xlsx, then try again.',
  pages: 'Pages files can’t be read here. In Pages, choose File → Export To → Word, then try again.',
  key: 'Keynote files can’t be read here. In Keynote, choose File → Export To → PowerPoint, then try again.',
  numbers: 'Numbers files can’t be read here. In Numbers, choose File → Export To → Excel, then try again.',
};

const MAX_BYTES = 40 * 1024 * 1024;

/** Whether this looks like a document Lectern can read (by name or type). */
export function isDocumentFile(file: { name: string; type: string }): boolean {
  return DOC_EXT.test(file.name) || file.type.startsWith('text/') || file.type === 'application/pdf';
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ODF_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const ODF_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODF_DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const ODF_PRES = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0';

function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

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
  return demoteExtraTitles(out);
}

/** A document with one top-level heading per section reads better with sections as slides. */
function demoteExtraTitles(out: string): string {
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

// ─── Tables ───────────────────────────────────────────────────────────

const MAX_ROWS = 30;
const MAX_COLS = 10;

/** A Markdown table, which outlineToDraft turns into a table slide. Long tables are cut short. */
export function markdownTable(rows: string[][]): string {
  const trimmed = rows
    .map((r) => r.slice(0, MAX_COLS).map((c) => clean(c).replace(/\|/g, '/')))
    .filter((r) => r.some(Boolean));
  if (!trimmed.length) return '';
  const width = Math.max(...trimmed.map((r) => r.length));
  const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const [head, ...body] = trimmed.slice(0, MAX_ROWS + 1);
  const lines = [pad(head!), `|${Array.from({ length: width }, () => '---').join('|')}|`, ...body.map(pad)];
  if (trimmed.length > MAX_ROWS + 1) lines.push('', `(${trimmed.length - MAX_ROWS - 1} more rows not shown)`);
  return lines.join('\n');
}

/** Splits CSV or TSV text into rows, honouring quoted cells. The delimiter is guessed when not given. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const sample = text.slice(0, 2000);
  const sep = delimiter ?? ((sample.match(/\t/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? '\t' : (sample.match(/;/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

async function xlsxToOutline(buffer: ArrayBuffer, title: string): Promise<string> {
  const zip = await loadZip(buffer);
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const shared = sharedXml
    ? Array.from(parse(sharedXml).getElementsByTagNameNS(S, 'si')).map((si) => Array.from(si.getElementsByTagNameNS(S, 't')).map((t) => t.textContent ?? '').join(''))
    : [];
  const wb = parse((await zip.file('xl/workbook.xml')?.async('string')) ?? '<workbook/>');
  const relsXml = parse((await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '<Relationships/>');
  const targets = new Map(Array.from(relsXml.getElementsByTagName('Relationship')).map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']));
  const sheets = Array.from(wb.getElementsByTagNameNS(S, 'sheet')).slice(0, 8);
  if (!sheets.length) throw new Error('This Excel file has no sheets.');
  const out = [`# ${title}`, ''];
  for (const sheet of sheets) {
    const target = targets.get(sheet.getAttributeNS(R, 'id') ?? sheet.getAttribute('r:id') ?? '') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const rows = Array.from(parse(xml).getElementsByTagNameNS(S, 'row')).slice(0, MAX_ROWS + 2).map((row) => {
      const cells: string[] = [];
      for (const c of Array.from(row.getElementsByTagNameNS(S, 'c'))) {
        const col = columnIndex(c.getAttribute('r') ?? '');
        if (col >= MAX_COLS) continue;
        const type = c.getAttribute('t');
        const v = c.getElementsByTagNameNS(S, 'v')[0]?.textContent ?? '';
        cells[col] = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? Array.from(c.getElementsByTagNameNS(S, 't')).map((t) => t.textContent ?? '').join('') : type === 'b' ? (v === '1' ? 'Yes' : 'No') : v;
      }
      return Array.from(cells, (x) => x ?? '');
    });
    const table = markdownTable(rows);
    if (table) out.push(`## ${sheet.getAttribute('name') || 'Sheet'}`, table, '');
  }
  return out.join('\n').trim();
}

// ─── PDF ──────────────────────────────────────────────────────────────

interface PdfLine { text: string; size: number; page: number }

/** Reads the text layer of a PDF. Larger, short lines become headings. Scans have no text layer. */
async function pdfToOutline(buffer: ArrayBuffer, title: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const lines: PdfLine[] = [];
  try {
    for (let n = 1; n <= Math.min(pdf.numPages, 300); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      let size = 0;
      let y: number | null = null;
      const push = () => {
        const t = clean(text);
        if (t) lines.push({ text: t, size, page: n });
        text = '';
        size = 0;
      };
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const itemY = item.transform[5] as number;
        const h = Math.abs((item.transform[3] as number) || item.height || 0);
        if (y !== null && Math.abs(itemY - y) > Math.max(2, h * 0.6)) push();
        text += item.str;
        size = Math.max(size, h);
        y = itemY;
        if (item.hasEOL) { push(); y = null; }
      }
      push();
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return pdfLinesToOutline(lines, title);
}

/** Turns positioned PDF lines into an outline. Exported for tests. */
export function pdfLinesToOutline(lines: PdfLine[], title: string): string {
  if (!lines.length) throw new Error('This PDF has no text to read. It may be a scan: export it with text recognition, or paste the text instead.');
  const sizes = lines.flatMap((l) => Array<number>(Math.min(20, Math.ceil(l.text.length / 10))).fill(l.size)).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 10;
  const isHeading = (l: PdfLine) => l.size >= body * 1.2 && l.text.length <= 100 && !/[,;]$/.test(l.text) && /\p{L}/u.test(l.text);
  const firstPage = lines.filter((l) => l.page === lines[0]!.page);
  const biggest = firstPage.reduce((m, l) => (l.size > m.size ? l : m), firstPage[0]!);
  const out: string[] = [`# ${biggest.size >= body * 1.2 ? biggest.text : title}`, ''];
  let page = lines[0]!.page;
  for (const l of lines) {
    if (l === biggest && biggest.size >= body * 1.2) continue;
    if (l.page !== page) { out.push(''); page = l.page; }
    if (/^\d+$/.test(l.text)) continue; // page numbers
    if (isHeading(l)) { out.push('', `## ${l.text}`); continue; }
    const prev = out[out.length - 1] ?? '';
    // Join wrapped lines of one paragraph.
    if (prev && !prev.startsWith('#') && !/^[-*•▪◦]|^\d+[.)]/.test(l.text) && !/[.!?:\u3002\uFF01\uFF1F]$/.test(prev) && /^[\p{Ll}(]/u.test(l.text)) {
      out[out.length - 1] = `${prev} ${l.text}`;
    } else out.push(l.text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Web pages and e-books ────────────────────────────────────────────

/** Reads the readable parts of a web page: headings, paragraphs, lists, quotes and tables. */
export function htmlToOutline(html: string, fallbackTitle = ''): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, nav, footer, svg, form, button, iframe, template').forEach((n) => n.remove());
  const out: string[] = [];
  const h1s = doc.querySelectorAll('h1');
  const title = clean(h1s[0]?.textContent ?? '') || clean(doc.title) || fallbackTitle;
  if (title) out.push(`# ${title}`, '');
  let tableRows = 0;
  for (const el of Array.from(doc.body?.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, pre, tr, dt, dd') ?? [])) {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'tr') tableRows = 0;
    if (tag === 'p' && el.closest('li, blockquote, td, th')) continue;
    if (tag === 'li' && el.querySelector('li')) continue;
    const text = clean(el.textContent ?? '');
    if (!text) continue;
    if (tag === 'h1') { if (el !== h1s[0]) out.push('', `## ${text}`); continue; }
    if (/^h[2-4]$/.test(tag)) out.push('', `## ${text}`);
    else if (tag === 'li') out.push(`- ${text}`);
    else if (tag === 'blockquote') out.push(`> ${text}`);
    else if (tag === 'pre') out.push(text);
    else if (tag === 'dt') out.push(`${text}:`);
    else if (tag === 'tr') {
      const cells = Array.from(el.querySelectorAll('th, td')).slice(0, MAX_COLS).map((c) => clean(c.textContent ?? '').replace(/\|/g, '/'));
      if (tableRows === 0) out.push('');
      if (tableRows <= MAX_ROWS) out.push(`| ${cells.join(' | ')} |`);
      if (tableRows === 0) out.push(`|${cells.map(() => '---').join('|')}|`);
      tableRows++;
    } else out.push(text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function epubToOutline(buffer: ArrayBuffer, fallbackTitle: string): Promise<string> {
  const zip = await loadZip(buffer);
  const container = parse((await zip.file('META-INF/container.xml')?.async('string')) ?? '<container/>');
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') ?? '';
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('This e-book couldn’t be opened.');
  const opf = parse(opfXml);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const hrefs = new Map(Array.from(opf.getElementsByTagName('item')).map((i) => [i.getAttribute('id') ?? '', i.getAttribute('href') ?? '']));
  const title = clean(opf.getElementsByTagName('dc:title')[0]?.textContent ?? '') || fallbackTitle;
  const out = [`# ${title}`, ''];
  let chars = 0;
  for (const ref of Array.from(opf.getElementsByTagName('itemref')).slice(0, 80)) {
    const href = hrefs.get(ref.getAttribute('idref') ?? '');
    const html = href ? await zip.file(decodeURIComponent(base + href))?.async('string') : undefined;
    if (!html) continue;
    const chapter = htmlToOutline(html).replace(/^# /gm, '## ');
    out.push(chapter, '');
    chars += chapter.length;
    if (chars > 400_000) break;
  }
  return out.join('\n').trim();
}

// ─── OpenDocument ─────────────────────────────────────────────────────

async function odfToOutline(buffer: ArrayBuffer, kind: 'odt' | 'odp' | 'ods', title: string): Promise<string> {
  const zip = await loadZip(buffer);
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new Error('This file has no readable text.');
  const doc = parse(xml);
  const out: string[] = [];
  const text = (el: Element) => clean(el.textContent ?? '');

  if (kind === 'ods') {
    out.push(`# ${title}`, '');
    for (const sheet of Array.from(doc.getElementsByTagNameNS(ODF_TABLE, 'table')).slice(0, 8)) {
      const rows = Array.from(sheet.getElementsByTagNameNS(ODF_TABLE, 'table-row')).slice(0, MAX_ROWS + 2).map((row) =>
        Array.from(row.getElementsByTagNameNS(ODF_TABLE, 'table-cell')).flatMap((cell) => {
          const repeat = Math.min(MAX_COLS, Number(cell.getAttributeNS(ODF_TABLE, 'number-columns-repeated') ?? 1) || 1);
          return Array<string>(repeat).fill(text(cell));
        }).slice(0, MAX_COLS));
      const table = markdownTable(rows);
      if (table) out.push(`## ${sheet.getAttributeNS(ODF_TABLE, 'name') || 'Sheet'}`, table, '');
    }
    return out.join('\n').trim();
  }

  if (kind === 'odp') {
    for (const [i, page] of Array.from(doc.getElementsByTagNameNS(ODF_DRAW, 'page')).entries()) {
      const frames = Array.from(page.getElementsByTagNameNS(ODF_DRAW, 'frame')).filter((f) => !f.closest('notes'));
      const titleFrame = frames.find((f) => /title/.test(f.getAttributeNS(ODF_PRES, 'class') ?? ''));
      const body = frames.filter((f) => f !== titleFrame).flatMap((f) => Array.from(f.getElementsByTagNameNS(ODF_TEXT, 'p')).map(text)).filter(Boolean);
      const notes = Array.from(page.getElementsByTagNameNS(ODF_PRES, 'notes')).map(text).join(' ');
      const heading = (titleFrame ? text(titleFrame) : '') || body.shift() || `Slide ${i + 1}`;
      out.push(i === 0 ? `# ${heading}` : `## ${heading}`, ...body.map((b) => (i === 0 ? b : `- ${b}`)));
      if (notes) out.push(`Notes: ${notes}`);
      out.push('');
    }
    return out.join('\n').trim();
  }

  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const ns = child.namespaceURI;
      const name = child.localName;
      if (ns === ODF_TEXT && name === 'h') {
        const level = Number(child.getAttributeNS(ODF_TEXT, 'outline-level') ?? 1);
        out.push(level <= 1 ? `# ${text(child)}` : `## ${text(child)}`);
      } else if (ns === ODF_TEXT && name === 'p') out.push(text(child));
      else if (ns === ODF_TEXT && name === 'list-item') {
        const t = Array.from(child.children).filter((c) => c.localName === 'p').map(text).join(' ');
        if (t) out.push(`- ${t}`);
        walk(child);
      } else if (ns === ODF_TABLE && name === 'table') {
        out.push('', markdownTable(Array.from(child.getElementsByTagNameNS(ODF_TABLE, 'table-row')).map((r) => Array.from(r.getElementsByTagNameNS(ODF_TABLE, 'table-cell')).map(text))), '');
      } else walk(child);
    }
  };
  const root = doc.getElementsByTagName('office:text')[0] ?? doc.documentElement;
  walk(root);
  return demoteExtraTitles(out.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}

// ─── Rich text and transcripts ────────────────────────────────────────

const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'object', 'fldinst']);
const RTF_CHARS: Record<string, string> = { emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', tab: '\t', cell: '\t' };

/** Plain text from an RTF document: groups that hold no visible text are dropped. */
export function rtfToText(rtf: string): string {
  let out = '';
  const stack: boolean[] = [];
  let skip = false;
  let i = 0;
  while (i < rtf.length) {
    const c = rtf[i]!;
    if (c === '{') { stack.push(skip); i++; continue; }
    if (c === '}') { skip = stack.pop() ?? false; i++; continue; }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') { if (!skip) out += c; i++; continue; }
    const next = rtf[i + 1] ?? '';
    if (next === '\\' || next === '{' || next === '}') { if (!skip) out += next; i += 2; continue; }
    if (next === "'") { if (!skip) out += String.fromCharCode(parseInt(rtf.slice(i + 2, i + 4), 16) || 32); i += 4; continue; }
    if (next === '*') { skip = true; i += 2; continue; }
    const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
    if (!m) { if (!skip && next === '~') out += ' '; i += 2; continue; }
    i += m[0].length;
    const word = m[1]!;
    if (RTF_SKIP.has(word)) { skip = true; continue; }
    if (skip) continue;
    if (word === 'par' || word === 'line' || word === 'row' || word === 'sect' || word === 'page') out += '\n';
    else if (RTF_CHARS[word]) out += RTF_CHARS[word];
    else if (word === 'u' && m[2]) {
      let code = Number(m[2]);
      if (code < 0) code += 65536;
      out += String.fromCharCode(code);
      // Skip the plain-text stand-in that follows a Unicode character.
      if (rtf[i] === '\\' && rtf[i + 1] === "'") i += 4;
      else if (rtf[i] && rtf[i] !== '\\' && rtf[i] !== '{' && rtf[i] !== '}') i++;
    }
  }
  return out.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The spoken text of an SRT or WebVTT file, as paragraphs. Repeated captions are kept once. */
export function subtitlesToText(text: string): string {
  const cues: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^WEBVTT/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line) || /^\d+$/.test(line) || line.includes('-->')) continue;
    const t = clean(line.replace(/<[^>]+>/g, '').replace(/^-\s*/, ''));
    if (t && t !== cues[cues.length - 1]) cues.push(t);
  }
  const paras: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const cue of cues) {
    current.push(cue);
    words += cue.split(/\s+/).length;
    if (words >= 70 && /[.!?\u3002\uFF01\uFF1F]$/.test(cue)) { paras.push(current.join(' ')); current = []; words = 0; }
  }
  if (current.length) paras.push(current.join(' '));
  return paras.join('\n\n');
}

// ─── Entry points ─────────────────────────────────────────────────────

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

export async function fileToOutline(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const ext = /\.([a-z0-9]+)$/.exec(name)?.[1] ?? '';
  if (SAVE_AS[ext]) throw new Error(SAVE_AS[ext]);
  if (file.size > MAX_BYTES) throw new Error('This file is over 40 MB. Choose a smaller file, or split it.');
  const title = stem(file.name);
  switch (ext) {
    case 'docx': return docxToOutline(await file.arrayBuffer());
    case 'pptx': return pptxToOutline(await file.arrayBuffer());
    case 'xlsx': return xlsxToOutline(await file.arrayBuffer(), title);
    case 'pdf': return pdfToOutline(await file.arrayBuffer(), title);
    case 'odt': case 'odp': case 'ods': return odfToOutline(await file.arrayBuffer(), ext, title);
    case 'epub': return epubToOutline(await file.arrayBuffer(), title);
    case 'html': case 'htm': return htmlToOutline(await file.text(), title);
    case 'rtf': return rtfToText(await file.text());
    case 'srt': case 'vtt': return subtitlesToText(await file.text());
    case 'csv': case 'tsv': return `# ${title}\n\n${markdownTable(parseDelimited(await file.text(), ext === 'tsv' ? '\t' : undefined))}`;
    case 'json': {
      const raw = await file.text();
      try { return JSON.stringify(JSON.parse(raw), null, 2).slice(0, 60_000); } catch { return raw.slice(0, 60_000); }
    }
    default:
      if (/\.(txt|md|markdown)$/.test(name) || file.type.startsWith('text/')) return (await file.text()).trim();
      if (file.type === 'application/pdf') return pdfToOutline(await file.arrayBuffer(), title);
      throw new Error('This file type can’t be read. Try a PDF, Word, PowerPoint, Excel, web page or text file.');
  }
}

const PICTURE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/**
 * Pictures inside a Word, PowerPoint, OpenDocument or EPUB file, largest first. Small images
 * (icons, bullets, logos) are left out.
 */
export async function documentPictures(file: File, max = 8): Promise<File[]> {
  const name = file.name.toLowerCase();
  const folder = name.endsWith('.docx') ? 'word/media/' : name.endsWith('.pptx') ? 'ppt/media/' : /\.(odt|odp)$/.test(name) ? 'Pictures/' : name.endsWith('.epub') ? '' : null;
  if (folder === null || file.size > MAX_BYTES) return [];
  const zip = await loadZip(await file.arrayBuffer());
  const found: { file: File; size: number }[] = [];
  for (const entry of Object.values(zip.files)) {
    const ext = /\.([a-z]+)$/i.exec(entry.name)?.[1]?.toLowerCase() ?? '';
    if (entry.dir || !entry.name.startsWith(folder) || !PICTURE_TYPES[ext]) continue;
    const blob = await entry.async('blob');
    if (blob.size < 12_000) continue;
    found.push({ file: new File([blob], `${stem(file.name)} · ${entry.name.split('/').pop()}`, { type: PICTURE_TYPES[ext] }), size: blob.size });
  }
  return found.sort((a, b) => b.size - a.size).slice(0, max).map((f) => f.file);
}

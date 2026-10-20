import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { outlineToDraft } from '../src/core/deck/outline';
import {
  documentPictures, fileToOutline, htmlToOutline, isDocumentFile, markdownTable, parseDelimited, pdfLinesToOutline,
  rtfToText, subtitlesToText,
} from '../src/core/import/files';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

describe('document readers', () => {
  it('splits CSV with quotes and guesses the delimiter', () => {
    expect(parseDelimited('name,score\n"Lee, A",9\n"Say ""hi""",7\n')).toEqual([['name', 'score'], ['Lee, A', '9'], ['Say "hi"', '7']]);
    expect(parseDelimited('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('writes Markdown tables that the outline reader turns into a table slide', () => {
    const table = markdownTable([['Region', 'Sales'], ['North', '12'], ['South | East', '9']]);
    expect(table).toContain('| Region | Sales |');
    expect(table).toContain('South / East');
    const draft = outlineToDraft(`# Results\n\n## By region\n${table}`, 'Results');
    expect(draft.slides.some((s) => s.kind === 'table')).toBe(true);
  });

  it('reads the text of RTF and skips font tables', () => {
    const rtf = ['{', 'rtf1', 'ansi{', 'fonttbl{', 'f0 Arial;}}{', 'colortbl;', 'red0', 'green0', 'blue0;}', 'f0 Hello ', 'b world', 'b0.', 'par Caf', "'e9 and ", 'u8364? euro', 'par}'].join('\\');
    expect(rtfToText(rtf)).toBe('Hello world.\nCafé and € euro');
  });

  it('turns subtitles into paragraphs without timings or repeats', () => {
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello everyone.\n\n2\n00:00:03.000 --> 00:00:05.000\nHello everyone.\n\n3\n00:00:05.000 --> 00:00:07.000\n<v Sam>Today we look at tides.</v>\n';
    expect(subtitlesToText(vtt)).toBe('Hello everyone. Today we look at tides.');
  });

  it('reads headings, lists and tables from a web page', () => {
    const html = '<html><head><title>T</title><style>p{}</style></head><body><nav>Menu</nav><h1>Ocean tides</h1><p>Tides rise twice a day.</p><h2>Why</h2><ul><li>The Moon pulls</li><li>The Sun helps</li></ul><table><tr><th>Place</th><th>Range</th></tr><tr><td>Bay of Fundy</td><td>16 m</td></tr></table><script>x()</script></body></html>';
    const out = htmlToOutline(html);
    expect(out.startsWith('# Ocean tides')).toBe(true);
    expect(out).toContain('## Why');
    expect(out).toContain('- The Moon pulls');
    expect(out).toContain('| Bay of Fundy | 16 m |');
    expect(out).not.toContain('Menu');
    expect(out).not.toContain('x()');
  });

  it('finds headings in PDF text by size and joins wrapped lines', () => {
    const out = pdfLinesToOutline([
      { text: 'Annual Report', size: 28, page: 1 },
      { text: 'Highlights', size: 16, page: 1 },
      { text: 'Revenue grew in every', size: 10, page: 1 },
      { text: 'region this year.', size: 10, page: 1 },
      { text: '1', size: 9, page: 1 },
      { text: 'Next steps', size: 16, page: 2 },
      { text: '• Hire two engineers', size: 10, page: 2 },
    ], 'report');
    expect(out).toBe('# Annual Report\n\n## Highlights\nRevenue grew in every region this year.\n\n## Next steps\n• Hire two engineers');
    expect(() => pdfLinesToOutline([], 'x')).toThrow(/no text/);
  });

  it('knows which files are documents and explains old formats', async () => {
    expect(isDocumentFile({ name: 'notes.PDF', type: '' })).toBe(true);
    expect(isDocumentFile({ name: 'clip.mp3', type: 'audio/mpeg' })).toBe(false);
    await expect(fileToOutline(new File(['x'], 'old.ppt'))).rejects.toThrow(/save it as \.pptx/);
    expect(await fileToOutline(new File(['a,b\n1,2'], 'data.csv'))).toContain('| a | b |');
  });

  it('reads an Excel sheet with shared strings', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Q3" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Product</t></si><si><t>Units</t></si><si><t>Kettle</t></si></sst>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>420</v></c></row></sheetData></worksheet>');
    const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'sales.xlsx');
    const out = await fileToOutline(file);
    expect(out).toContain('# sales');
    expect(out).toContain('## Q3');
    expect(out).toContain('| Kettle | 420 |');
  });

  it('pulls large pictures out of a Word file and skips icons', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
    zip.file('word/media/image1.png', new Uint8Array(20_000));
    zip.file('word/media/icon.png', new Uint8Array(500));
    const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'brief.docx');
    const pics = await documentPictures(file);
    expect(pics.map((p) => p.name)).toEqual(['brief · image1.png']);
    expect(pics[0]!.type).toBe('image/png');
  });
});

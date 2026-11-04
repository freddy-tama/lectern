import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { decodeHtml, detailsLine, documentDetails, fileToOutline, htmlDetails, isoDay } from '../src/core/import/files';
import { asLink, mergeDetails } from '../src/features/autodeck/links';
import { buildMaterial, originLine } from '../src/features/autodeck/make';

const PAGE = `<!-- saved from url=(0040)https://www.example.edu/news/mandarin -->
<html><head>
<title>Mandarin in schools</title>
<link rel="canonical" href="https://www.example.edu/news/mandarin-in-schools">
<meta property="og:site_name" content="Example University">
<meta name="author" content="Siti Rahma">
<meta property="article:published_time" content="2025-03-02T08:00:00+07:00">
<meta property="article:modified_time" content="2025-06-10">
</head><body><h1>Mandarin in schools</h1><p>More schools teach it.</p></body></html>`;

describe('where a document comes from', () => {
  it('reads a web page’s address, site, author and dates', () => {
    expect(htmlDetails(PAGE)).toEqual({
      url: 'https://www.example.edu/news/mandarin-in-schools',
      site: 'Example University',
      author: 'Siti Rahma',
      published: '2025-03-02',
      modified: '2025-06-10',
    });
  });

  it('falls back to JSON-LD, a <time> tag and the "saved from" comment', () => {
    const ld = `<!-- saved from url=(0027)https://news.example.com/a -->
      <html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","datePublished":"2024-11-20","author":{"name":"Budi"}}]}</script></head>
      <body><time datetime="2020-01-01">old</time></body></html>`;
    expect(htmlDetails(ld)).toEqual({ url: 'https://news.example.com/a', author: 'Budi', published: '2024-11-20' });
  });

  it('reads dates written in several ways', () => {
    expect(isoDay('D:20250302101500+07')).toBe('2025-03-02');
    expect(isoDay('2024-07-01T00:00:00Z')).toBe('2024-07-01');
    expect(isoDay('Wed, 21 Oct 2025 07:28:00 GMT')).toBe('2025-10-21');
    expect(isoDay('soon')).toBe('');
  });

  it('reads the author and dates an Office file records', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
    zip.file('docProps/core.xml', `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
      <dc:creator>Dewi</dc:creator><dcterms:created>2023-05-04T10:00:00Z</dcterms:created><dcterms:modified>2025-01-09T10:00:00Z</dcterms:modified></cp:coreProperties>`);
    const file = new File([await zip.generateAsync({ type: 'blob' })], 'survey.docx');
    expect(await documentDetails(file)).toEqual({ author: 'Dewi', published: '2023-05-04', modified: '2025-01-09' });
    // A file that says nothing gives nothing, and never throws.
    expect(await documentDetails(new File(['plain'], 'notes.txt'))).toEqual({});
  });

  it('gives the AI one line per file, and the list a short one', () => {
    const d = htmlDetails(PAGE);
    expect(detailsLine(d)).toBe('from https://www.example.edu/news/mandarin-in-schools; site Example University; by Siti Rahma; published 2025-03-02; updated 2025-06-10');
    expect(originLine(d)).toBe('Example University · 2 Mar 2025');
    expect(originLine({ url: 'https://www.bps.go.id/x' })).toBe('bps.go.id');
    const material = buildMaterial([{ file: new File([], 'page.html'), kind: 'doc', text: 'Facts.', details: d }]);
    expect(material.split('\n')[0]).toBe(`=== page.html (document; ${detailsLine(d)}) ===`);
    expect(buildMaterial([{ file: new File([], 'a.txt'), kind: 'doc', text: 'Facts.' }]).split('\n')[0]).toBe('=== a.txt (document) ===');
  });
});

describe('pasted links', () => {
  it('takes whole links, and adds https to www. ones', () => {
    expect(asLink(' https://example.org/a b')).toBeNull();
    expect(asLink('https://example.org/a')).toBe('https://example.org/a');
    expect(asLink('www.example.org')).toBe('https://www.example.org/');
    expect(asLink('ftp://example.org')).toBeNull();
    expect(asLink('not a link')).toBeNull();
  });

  it('keeps the pasted address and the page’s own dates', () => {
    expect(mergeDetails({ url: 'https://a.org/x', modified: '2025-01-01' }, { url: 'https://a.org/canonical', published: '2024-12-01' }))
      .toMatchObject({ url: 'https://a.org/x', published: '2024-12-01', modified: '2025-01-01' });
  });
});

describe('page charsets', () => {
  it('decodes a GBK page by its <meta> tag, or by the server’s header', async () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // 你好
    const head = new TextEncoder().encode('<html><head><meta charset="gbk"></head><body><p>');
    const tail = new TextEncoder().encode('</p></body></html>');
    const page = new Uint8Array([...head, ...gbk, ...tail]);
    expect(decodeHtml(page)).toContain('你好');
    expect(decodeHtml(new Uint8Array([...gbk]), 'text/html; charset=gbk')).toBe('你好');
    expect(await fileToOutline(new File([page], 'page.html', { type: 'text/html' }))).toContain('你好');
  });
});

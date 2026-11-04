// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GET, pageKind, pageName } from '../api/page-fetch';

const bytes = (s: string) => new TextEncoder().encode(s);
const url = (s: string) => new URL(s);

describe('what a downloaded link is', () => {
  it('tells pictures, PDFs and zipped documents by their bytes, whatever the server says', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(pageKind(png, 'text/html', url('https://a.org/x'))).toEqual({ type: 'image/png', ext: 'png' });
    expect(pageKind(bytes('%PDF-1.7 …'), 'application/octet-stream', url('https://a.org/report'))).toEqual({ type: 'application/pdf', ext: 'pdf' });
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
    expect(pageKind(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url('https://a.org/d'))?.ext).toBe('docx');
    expect(pageKind(zip, 'application/octet-stream', url('https://a.org/files/data.xlsx'))?.ext).toBe('xlsx');
    // A zip that is no document Lectern reads.
    expect(pageKind(zip, 'application/zip', url('https://a.org/files/all.zip'))).toBeNull();
  });

  it('keeps the charset of a web page, and reads pages served without a type', () => {
    expect(pageKind(bytes('<html><body>你好</body></html>'), 'text/html; charset=GBK', url('https://a.cn/'))).toEqual({ type: 'text/html; charset=gbk', ext: 'html' });
    expect(pageKind(bytes('<!DOCTYPE html><html>'), '', url('https://a.org/'))?.ext).toBe('html');
    expect(pageKind(bytes('a,b\n1,2'), 'text/csv', url('https://a.org/x'))?.ext).toBe('csv');
  });

  it('refuses binary files it can’t read', () => {
    expect(pageKind(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), 'video/mp4', url('https://a.org/v.mp4'))).toBeNull();
  });

  it('names the file after the link, or the site when the link has no name', () => {
    expect(pageName(url('https://a.org/docs/Annual%20report.pdf'), 'pdf')).toBe('Annual report.pdf');
    expect(pageName(url('https://www.unesa.ac.id/'), 'html')).toBe('unesa.ac.id.html');
    expect(pageName(url('https://a.org/news/12345'), 'html')).toBe('12345.html');
  });
});

describe('GET', () => {
  it('refuses private addresses and a missing link, with a reason', async () => {
    const res = await GET(new Request(`http://x/api/page-fetch?url=${encodeURIComponent('http://127.0.0.1/admin')}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/private network/);
    expect((await GET(new Request('http://x/api/page-fetch'))).status).toBe(400);
  });
});

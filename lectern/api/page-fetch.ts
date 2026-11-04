// Vercel function: downloads a web page, a document or a picture from a link someone pasted, so
// the deck maker can read it like a dropped file.
// GET /api/page-fetch?url=https://… → the file's bytes, or { error }
//
// Safety:
//   - The same checks as api/picture-fetch.ts against server-side request forgery: public http
//     and https addresses only, checked again as each socket connects and on every redirect.
//   - The reply is always application/octet-stream, sent as an attachment with nosniff, so a
//     fetched page can never run as a page of this site. Its real type travels in x-source-type.
//   - At most 20 MB. Only types the deck maker reads: web pages, text, PDF, Office, OpenDocument
//     and EPUB files, and JPEG, PNG, WebP or GIF pictures.
//
// Reply headers: x-source-type (with the charset of text), x-source-url (after redirects),
// x-source-name (a file name to give it) and x-source-modified (the server's Last-Modified).

import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { PictureFetchError, type Resolve, guardedLookup, parsePictureUrl, sniffImage, streamOf } from './picture-fetch.js';

export const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; Lectern/0.1; reads a page someone pasted into a slide maker)';

const systemResolve: Resolve = (hostname, done) => dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => done(error, addresses ?? []));

/** Zipped documents by the extension a link or its type gives them. */
const ZIP_TYPES: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/epub+zip': 'epub',
};
const ZIP_EXTS = new Set(Object.values(ZIP_TYPES));

const TEXT_TYPES: Record<string, string> = {
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/json': 'json',
  'text/rtf': 'rtf',
  'application/rtf': 'rtf',
  'text/vtt': 'vtt',
};

export interface PageKind {
  /** The type to read it as, such as "text/html; charset=gbk", "application/pdf" or "image/png". */
  type: string;
  /** The extension the deck maker reads it by. */
  ext: string;
}

const extOf = (url: URL) => /\.([a-z0-9]{2,5})$/i.exec(decodeURIComponent(url.pathname))?.[1]?.toLowerCase() ?? '';

/**
 * What a download is, from its first bytes, then its Content-Type, then its link. Pictures, PDFs
 * and zipped documents are told by their bytes, so a mislabelled file is still read right.
 * Null when the deck maker can't read it.
 */
export function pageKind(bytes: Uint8Array, contentType: string, url: URL): PageKind | null {
  const picture = sniffImage(bytes);
  if (picture) return { type: picture, ext: picture.split('/')[1]!.replace('jpeg', 'jpg') };
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  const declared = contentType.split(';')[0]!.trim().toLowerCase();
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  if (head.startsWith('PK\u0003\u0004')) {
    const ext = ZIP_TYPES[declared] ?? (ZIP_EXTS.has(extOf(url)) ? extOf(url) : '');
    return ext ? { type: declared || 'application/zip', ext } : null;
  }
  // Binary that isn't one of the above: a video, an archive, an old Office file.
  if (bytes.subarray(0, 512).some((b) => b === 0)) return null;
  const withCharset = (t: string) => (charset ? `${t}; charset=${charset}` : t);
  if (TEXT_TYPES[declared]) return { type: withCharset(declared), ext: TEXT_TYPES[declared]! };
  const start = new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).toLowerCase();
  if (/<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/.test(start)) return { type: withCharset('text/html'), ext: 'html' };
  if (!declared || declared === 'application/octet-stream') {
    const ext = extOf(url);
    if (['txt', 'md', 'csv', 'tsv', 'json', 'rtf', 'vtt', 'srt'].includes(ext)) return { type: withCharset('text/plain'), ext };
  }
  return null;
}

/** A file name for the download: the link's own name when it has the right extension, else the site's name. */
export function pageName(url: URL, ext: string): string {
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (last && extOf(url) === ext) return safe(last);
  const stem = safe(last.replace(/\.[a-z0-9]{1,5}$/i, '')) || url.hostname.replace(/^www\./, '');
  return `${stem}.${ext}`;
}

function networkMessage(error: NodeJS.ErrnoException): PictureFetchError {
  if (error instanceof PictureFetchError) return error;
  switch (error.code) {
    case 'EPRIVATE': return new PictureFetchError(error.message, 400);
    case 'ENOTFOUND':
    case 'EAI_AGAIN': return new PictureFetchError('That site couldn’t be found. Check the link.', 502);
    case 'ECONNREFUSED':
    case 'ECONNRESET': return new PictureFetchError('The site refused the connection. Try again later, or save the page and drop the file in.', 502);
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'ERR_TLS_CERT_ALTNAME_INVALID': return new PictureFetchError('The site has a broken security certificate, so it wasn’t read.', 502);
    default: return new PictureFetchError('The page couldn’t be downloaded. Save it in your browser and drop the file in instead.', 502);
  }
}

function requestOnce(url: URL, resolve: Resolve): Promise<http.IncomingMessage> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((done, fail) => {
    const req = client.get(url, {
      lookup: guardedLookup(resolve) as unknown as http.RequestOptions['lookup'],
      timeout: TIMEOUT_MS,
      agent: false,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'accept-language': 'en;q=0.9,*;q=0.8',
      },
    }, done);
    req.on('timeout', () => req.destroy(new PictureFetchError('The site took too long to answer.', 504)));
    req.on('error', (error) => fail(networkMessage(error)));
  });
}

const TOO_BIG = 'This file is over 20 MB. Download it and drop it in instead.';

function readCapped(res: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAGE_BYTES) {
        res.destroy();
        fail(new PictureFetchError(TOO_BIG, 413));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => done(new Uint8Array(Buffer.concat(chunks))));
    res.on('error', (error) => fail(networkMessage(error)));
    res.setTimeout(TIMEOUT_MS, () => res.destroy(new PictureFetchError('The page took too long to download.', 504)));
  });
}

export interface DownloadedPage extends PageKind {
  bytes: Uint8Array;
  /** The address after redirects. */
  url: string;
  name: string;
  /** The server's Last-Modified header, when it sent one. */
  modified: string;
}

/** Downloads one page or file with every check above. Throws PictureFetchError with a message for people. */
export async function downloadPage(input: string, resolve: Resolve = systemResolve): Promise<DownloadedPage> {
  let url = parsePictureUrl(input);
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, resolve);
    const status = res.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      res.resume();
      const location = res.headers.location;
      if (!location || hop >= MAX_REDIRECTS) throw new PictureFetchError('The link redirected too many times.', 502);
      url = parsePictureUrl(new URL(location, url).toString());
      continue;
    }
    if (status === 401 || status === 403) {
      res.resume();
      throw new PictureFetchError('That site doesn’t let Lectern read the page. Save it in your browser (Ctrl+S) and drop the file in instead.', 502);
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new PictureFetchError(status === 404 || status === 410 ? 'There’s nothing at that link any more.' : `The site answered with an error (${status}).`, 502);
    }
    if (Number(res.headers['content-length'] ?? 0) > MAX_PAGE_BYTES) {
      res.destroy();
      throw new PictureFetchError(TOO_BIG, 413);
    }
    const bytes = await readCapped(res);
    const kind = pageKind(bytes, String(res.headers['content-type'] ?? ''), url);
    if (!kind) throw new PictureFetchError('That link isn’t a web page, document or picture Lectern can read.', 415);
    return { ...kind, bytes, url: url.toString(), name: pageName(url, kind.ext), modified: String(res.headers['last-modified'] ?? '') };
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/** Header values must be Latin-1: names and addresses travel percent-encoded. */
const header = (s: string) => encodeURIComponent(s);

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  if (!target) return json({ error: 'Add the page’s link as ?url=' }, 400);
  try {
    const page = await downloadPage(target);
    return new Response(streamOf(page.bytes), {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment',
        'content-length': String(page.bytes.length),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        // Other sites can't use this as their own page proxy.
        'cross-origin-resource-policy': 'same-origin',
        'x-source-type': page.type,
        'x-source-url': header(page.url),
        'x-source-name': header(page.name),
        'x-source-modified': header(page.modified),
      },
    });
  } catch (error) {
    if (error instanceof PictureFetchError) return json({ error: error.message }, error.status);
    return json({ error: 'The page couldn’t be downloaded. Save it in your browser and drop the file in instead.' }, 502);
  }
}

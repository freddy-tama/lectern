// A link someone pastes into the deck maker: the server downloads it (api/_lib/page-fetch.ts), and
// it comes back as a file, so a web page, a PDF or a picture is read like one that was dropped.

import { type DocDetails, decodeHtml, isoDay } from '../../core/import/files';

export interface LinkedFile {
  file: File;
  /** The address after redirects. */
  url: string;
  picture: boolean;
  /** What the server said about the file: its address and the date it last changed. */
  details: DocDetails;
}

/** Whether a pasted text is a link to try. Spaces around it are fine; "www." links get https. */
export function asLink(text: string): string | null {
  const s = text.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^www\./i.test(s) ? `https://${s}` : s;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const readHeader = (res: Response, name: string) => {
  const v = res.headers.get(name) ?? '';
  try { return decodeURIComponent(v); } catch { return v; }
};

/** Downloads a pasted link through the server. Throws an Error with a message for people. */
export async function fetchLink(link: string, signal?: AbortSignal): Promise<LinkedFile> {
  let res: Response;
  try {
    res = await fetch(`/api/picture-fetch?kind=page&url=${encodeURIComponent(link)}`, { signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error('Lectern couldn’t reach its server to read the link. Check your connection.');
  }
  const type = res.headers.get('x-source-type') ?? '';
  if (!res.ok || !type) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === 'string') throw new Error(body.error);
    throw new Error(res.status === 404 ? 'This copy of Lectern has no server to read links with. Save the page and drop the file in.' : 'The link couldn’t be read. Save the page and drop the file in instead.');
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const url = readHeader(res, 'x-source-url') || link;
  const name = readHeader(res, 'x-source-name') || 'page.html';
  const modified = isoDay(readHeader(res, 'x-source-modified'));
  const mime = type.split(';')[0]!.trim();
  const details: DocDetails = { url, ...(modified ? { modified } : {}) };
  if (mime.startsWith('image/')) return { file: new File([bytes], name, { type: mime }), url, picture: true, details };
  // A web page keeps its bytes, with the charset the server named in its type, so the reader
  // decodes it once (a page's own <meta> tag counts when the server named none).
  if (/\.html?$/i.test(name)) return { file: new File([bytes], name, { type: type.replace('application/xhtml+xml', 'text/html') }), url, picture: false, details };
  // Other text arrives in its own charset too: decode it here, so the readers get UTF-8.
  if (mime.startsWith('text/') || mime === 'application/json') {
    return { file: new File([decodeHtml(bytes, type.includes('charset') ? type : 'charset=utf-8')], name, { type: `${mime};charset=utf-8` }), url, picture: false, details };
  }
  return { file: new File([bytes], name, { type: mime }), url, picture: false, details };
}

/** Merges what the server said with what the page says about itself: the page's own dates win, the address pasted wins. */
export function mergeDetails(fromServer: DocDetails, fromFile: DocDetails): DocDetails {
  return { ...fromServer, ...fromFile, url: fromServer.url ?? fromFile.url, modified: fromFile.modified ?? fromServer.modified };
}

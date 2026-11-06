// Vercel function: downloads a picture for the studio, so search results and pasted links
// are kept in the browser as files instead of being hotlinked from someone else's server.
// GET /api/picture-fetch?url=https://… → the picture's bytes (JPEG, PNG, WebP or GIF), or { error }
// GET /api/picture-fetch?kind=page&url=https://… → a web page, document or picture someone pasted
//   into the deck maker, as api/_lib/page-fetch.ts describes. One function serves both, because
//   the Hobby plan allows 12 functions a deployment.
//
// Guarded against server-side request forgery:
//   - http and https only, on ports 80 and 443, with no user name or password in the link;
//   - names for this machine or a local network are refused, and so are private IP literals;
//   - every address a name resolves to is checked again when the socket connects, so a name
//     that changes its answer after the first check (DNS rebinding) still can't reach inside;
//   - redirects are followed by hand, at most 4, and each hop is checked the same way.
// At most 12 MB. The type comes from the file's first bytes, never its extension or Content-Type.

import http from 'node:http';
import https from 'node:https';
import { PictureFetchError, type Resolve, guardedLookup, parsePictureUrl, sniffImage, streamOf, systemResolve } from './_lib/fetch-guard.js';
import { pageResponse } from './_lib/page-fetch.js';

export { PictureFetchError, type Resolve, guardedLookup, isPrivateAddress, parsePictureUrl, sniffImage, streamOf } from './_lib/fetch-guard.js';

export const MAX_PICTURE_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;
// Wikimedia's API refuses requests from cloud servers (EdgeOne's, for one) unless the user agent
// says how to reach the operator: https://meta.wikimedia.org/wiki/User-Agent_policy
const USER_AGENT = 'Lectern/0.1 (https://github.com/freddy-tama/lectern; slide picture finder)';

function networkMessage(error: NodeJS.ErrnoException): PictureFetchError {
  if (error instanceof PictureFetchError) return error;
  switch (error.code) {
    case 'EPRIVATE': return new PictureFetchError(error.message, 400);
    case 'ENOTFOUND':
    case 'EAI_AGAIN': return new PictureFetchError('That site couldn’t be found. Check the link.', 502);
    case 'ECONNREFUSED':
    case 'ECONNRESET': return new PictureFetchError('The picture’s server refused the connection. Try another picture.', 502);
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'ERR_TLS_CERT_ALTNAME_INVALID': return new PictureFetchError('The picture’s site has a broken security certificate, so it wasn’t downloaded.', 502);
    default: return new PictureFetchError('The picture couldn’t be downloaded. Try another one.', 502);
  }
}

function requestOnce(url: URL, resolve: Resolve): Promise<http.IncomingMessage> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((done, fail) => {
    const req = client.get(url, {
      lookup: guardedLookup(resolve) as unknown as http.RequestOptions['lookup'],
      timeout: TIMEOUT_MS,
      agent: false,
      // WebP isn't asked for: PowerPoint takes JPEG and PNG as they are.
      headers: { 'user-agent': USER_AGENT, accept: 'image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.3' },
    }, done);
    req.on('timeout', () => req.destroy(new PictureFetchError('The picture’s server took too long to answer.', 504)));
    req.on('error', (error) => fail(networkMessage(error)));
  });
}

function readCapped(res: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PICTURE_BYTES) {
        res.destroy();
        fail(new PictureFetchError('This picture is over 12 MB. Choose a smaller one.', 413));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => done(new Uint8Array(Buffer.concat(chunks))));
    res.on('error', (error) => fail(networkMessage(error)));
    res.setTimeout(TIMEOUT_MS, () => res.destroy(new PictureFetchError('The picture took too long to download.', 504)));
  });
}

export interface DownloadedPicture {
  bytes: Uint8Array;
  type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** The address after redirects. */
  url: string;
}

/** Downloads one picture with every check above. Throws PictureFetchError with a message for people. */
export async function downloadPicture(input: string, resolve: Resolve = systemResolve): Promise<DownloadedPicture> {
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
    if (status < 200 || status >= 300) {
      res.resume();
      throw new PictureFetchError(status === 404 || status === 410 ? 'There’s no picture at that link any more.' : `The picture’s server answered with an error (${status}).`, 502);
    }
    const declared = Number(res.headers['content-length'] ?? 0);
    if (declared > MAX_PICTURE_BYTES) {
      res.destroy();
      throw new PictureFetchError('This picture is over 12 MB. Choose a smaller one.', 413);
    }
    const bytes = await readCapped(res);
    const type = sniffImage(bytes);
    if (!type) throw new PictureFetchError('That link isn’t a JPEG, PNG, WebP or GIF picture. If it’s a web page, open it and copy the picture’s own address.', 415);
    return { bytes, type, url: url.toString() };
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get('url') ?? '';
  if (params.get('kind') === 'page') return pageResponse(target);
  if (!target) return json({ error: 'Add the picture’s link as ?url=' }, 400);
  try {
    const picture = await downloadPicture(target);
    return new Response(streamOf(picture.bytes), {
      headers: {
        'content-type': picture.type,
        'content-length': String(picture.bytes.length),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        // Other sites can't use this as their own picture proxy.
        'cross-origin-resource-policy': 'same-origin',
        'x-picture-url': encodeURI(picture.url),
      },
    });
  } catch (error) {
    if (error instanceof PictureFetchError) return json({ error: error.message }, error.status);
    return json({ error: 'The picture couldn’t be downloaded. Try another one.' }, 502);
  }
}

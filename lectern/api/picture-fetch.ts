// Vercel function: downloads a picture for the studio, so search results and pasted links
// are kept in the browser as files instead of being hotlinked from someone else's server.
// GET /api/picture-fetch?url=https://… → the picture's bytes (JPEG, PNG, WebP or GIF), or { error }
//
// Guarded against server-side request forgery:
//   - http and https only, on ports 80 and 443, with no user name or password in the link;
//   - names for this machine or a local network are refused, and so are private IP literals;
//   - every address a name resolves to is checked again when the socket connects, so a name
//     that changes its answer after the first check (DNS rebinding) still can't reach inside;
//   - redirects are followed by hand, at most 4, and each hop is checked the same way.
// At most 12 MB. The type comes from the file's first bytes, never its extension or Content-Type.

import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export const MAX_PICTURE_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;
const USER_AGENT = 'Lectern/0.1 (slide picture finder)';

export class PictureFetchError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const BLOCKED = 'Links to this computer or a private network are blocked.';

function ipv4Parts(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const nums = parts.map(Number);
  return nums.every((n) => n <= 255) ? nums : null;
}

function privateV4([a, b, c]: number[]): boolean {
  return a === 0 // "this network"
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT, also used inside clouds
    || (a === 169 && b === 254) // link-local, including cloud metadata services
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 168)
    || a >= 224; // multicast, reserved and broadcast
  // 198.18.0.0/15 stays allowed on purpose: proxy tools such as Clash answer every name with
  // 198.18.x.x ("fake IP"), and blocking it would break every picture on those machines.
}

/** Eight 16-bit groups, or null when the text isn't an IPv6 address. */
function ipv6Groups(address: string): number[] | null {
  let s = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const p = ipv4Parts(dotted[1]);
    if (!p) return null;
    s = `${s.slice(0, -dotted[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const groups = tail === null ? head : [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

const v4From = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/** True for addresses on this machine, a private network, link-local or multicast. Text that isn't an IP counts as private. */
export function isPrivateAddress(input: string): boolean {
  const address = String(input ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const version = isIP(address);
  if (version === 4) {
    const parts = ipv4Parts(address);
    return !parts || privateV4(parts);
  }
  if (version !== 6) return true;
  const g = ipv6Groups(address);
  if (!g) return true;
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8)) return true; // ::
  if (zeros(0, 7) && g[7] === 1) return true; // ::1
  if (zeros(0, 5) && g[5] === 0xffff) return privateV4(v4From(g[6], g[7])); // ::ffff:a.b.c.d
  if (zeros(0, 6)) return true; // deprecated ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return privateV4(v4From(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return privateV4(v4From(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x100 && zeros(1, 4)) return true; // discard 100::/64
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  return false;
}

/** Parses a picture link and refuses anything that could reach this server's own network. Network-free. */
export function parsePictureUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    throw new PictureFetchError('That isn’t a web address. Paste a link that starts with https://');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new PictureFetchError('Only http and https links can be used.');
  if (url.username || url.password) throw new PictureFetchError('Links with a user name or password in them can’t be used.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new PictureFetchError('Links on unusual ports are blocked. Use a normal http or https link.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || (!host.includes('.') && !isIP(host))) throw new PictureFetchError(BLOCKED);
  if (host === 'localhost' || /\.(localhost|local|internal|intranet|lan|home\.arpa)$/.test(host)) throw new PictureFetchError(BLOCKED);
  if (isIP(host) && isPrivateAddress(host)) throw new PictureFetchError(BLOCKED);
  return url;
}

export type Resolve = (hostname: string, done: (error: Error | null, addresses: { address: string; family: number }[]) => void) => void;

const systemResolve: Resolve = (hostname, done) => dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => done(error, addresses ?? []));

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/**
 * A `lookup` for http.get that only ever hands out public addresses. Node calls it as it opens
 * the socket, so the address checked is the address dialled.
 */
export function guardedLookup(resolve: Resolve = systemResolve) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    resolve(hostname, (error, addresses) => {
      if (error) return callback(error, '', 0);
      const safe = addresses.filter((a) => !isPrivateAddress(a.address));
      if (!safe.length) {
        const blocked = Object.assign(new Error('That link points to a private network address, so it was blocked.'), { code: 'EPRIVATE' }) as NodeJS.ErrnoException;
        return callback(blocked, '', 0);
      }
      if (typeof options === 'object' && options?.all) return callback(null, safe);
      return callback(null, safe[0].address, safe[0].family);
    });
  };
}

/** The image type from a file's first bytes. */
export function sniffImage(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null {
  const at = (i: number) => bytes[i];
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return 'image/png';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  return null;
}

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

/** Sends the bytes as a stream, so large pictures aren't held to the platform's limit for buffered replies. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.subarray(offset, offset + 256 * 1024));
      offset += 256 * 1024;
    },
  });
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('url') ?? '';
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

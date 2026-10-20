// Vercel function: searches free picture libraries for the studio's picture finder.
// GET /api/picture-search                          → { providers: ['openverse', 'commons', 'pexels'?] }
// GET /api/picture-search?q=…&from=openverse&page=1&shape=wide → { results: [...] } or { error }
//
// Each library is asked separately, so fast ones show up while slow ones are still answering.
// The browser ranks and filters the results (size, shape, licence, no logos or icons).
//
// Environment:
//   PEXELS_API_KEY            optional; adds Pexels photos
//   OPENVERSE_CLIENT_ID       optional, with OPENVERSE_CLIENT_SECRET; raises Openverse's limits
//   OPENVERSE_CLIENT_SECRET   (anonymous use has low rate limits)

const USER_AGENT = 'Lectern/0.1 (slide picture finder)';
const PER_PAGE = 20;

export type PictureProvider = 'openverse' | 'commons' | 'pexels';
type Shape = 'wide' | 'tall' | 'square';

/** One search result, the same shape for every library. */
export interface FoundPicture {
  id: string;
  provider: PictureProvider;
  title: string;
  /** Small preview for the results grid. */
  thumb: string;
  /** What to download: a slide-sized copy where the library offers one. */
  url: string;
  /** The page that describes the picture and its licence. */
  page: string;
  width: number;
  height: number;
  mime: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** Tags or a description, for matching the search words. */
  text: string;
  /** Position in the library's own results (its idea of relevance). */
  order: number;
  /** Drawn as vectors (SVG) and downloaded as a rendered copy. */
  vector?: boolean;
}

function json(data: unknown, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });
}

/** Plain text from the HTML that libraries put in author and description fields. */
export function plainText(value: unknown, max = 300): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const https = (value: unknown) => (/^https?:\/\//i.test(String(value ?? '')) ? String(value) : '');

function mimeFromUrl(url: string): string {
  const ext = /\.([a-z0-9]{3,4})(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? '';
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' }[ext] ?? '';
}

// ─── Openverse ────────────────────────────────────────────────────────

let openverseToken: { value: string; expires: number } | null = null;

async function openverseAuth(): Promise<Record<string, string>> {
  const id = process.env.OPENVERSE_CLIENT_ID;
  const secret = process.env.OPENVERSE_CLIENT_SECRET;
  if (!id || !secret) return {};
  if (!openverseToken || openverseToken.expires < Date.now() + 60_000) {
    const res = await fetch('https://api.openverse.org/v1/auth_tokens/token/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) as { access_token?: string; expires_in?: number } | null : null;
    if (!data?.access_token) return {};
    openverseToken = { value: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  }
  return { authorization: `Bearer ${openverseToken.value}` };
}

/** "by-nc-sa" + "2.0" → "CC BY-NC-SA 2.0". */
export function openverseLicense(license: unknown, version: unknown): string {
  const id = String(license ?? '').toLowerCase();
  const v = String(version ?? '').trim();
  if (!id) return '';
  if (id === 'cc0') return `CC0 ${v || '1.0'}`;
  if (id === 'pdm') return 'Public Domain Mark';
  if (id === 'sampling+' || id === 'nc-sampling+') return `CC ${id.toUpperCase()} ${v}`.trim();
  return `CC ${id.toUpperCase()} ${v}`.trim();
}

async function searchOpenverse(q: string, page: number): Promise<FoundPicture[]> {
  const params = new URLSearchParams({ q, page: String(page), page_size: String(PER_PAGE), mature: 'false' });
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { 'user-agent': USER_AGENT, ...(await openverseAuth()) },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429) throw new Error('Openverse has had too many searches from this server for now. Try again later.');
  if (!res.ok) throw new Error(`Openverse didn’t answer (${res.status}).`);
  const data = await res.json() as { results?: Record<string, unknown>[] };
  return (data.results ?? []).flatMap((item, order): FoundPicture[] => {
    const url = https(item.url);
    const mime = item.filetype ? `image/${String(item.filetype).toLowerCase().replace('jpg', 'jpeg')}` : mimeFromUrl(url) || 'image/jpeg';
    if (!url) return [];
    const tags = Array.isArray(item.tags) ? (item.tags as { name?: string }[]).map((t) => t?.name ?? '').filter(Boolean).slice(0, 12).join(' ') : '';
    return [{
      id: `openverse:${String(item.id ?? url)}`,
      provider: 'openverse',
      title: plainText(item.title, 160),
      thumb: https(item.thumbnail) || url,
      url,
      page: https(item.foreign_landing_url) || https(item.detail_url),
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      mime,
      author: plainText(item.creator, 120),
      license: openverseLicense(item.license, item.license_version),
      licenseUrl: https(item.license_url),
      text: tags,
      order,
    }];
  });
}

// ─── Wikimedia Commons ────────────────────────────────────────────────

interface CommonsPage {
  pageid?: number;
  title?: string;
  index?: number;
  imageinfo?: {
    url?: string; thumburl?: string; thumbwidth?: number; thumbheight?: number; width?: number; height?: number;
    mime?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: unknown }>;
  }[];
}

async function searchCommons(q: string, page: number, shape: Shape): Promise<FoundPicture[]> {
  // Commons only makes copies at its standard widths (250, 330, 500, 960, 1280, 1920…).
  const width = shape === 'tall' ? 1280 : 1920;
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `${q} filetype:bitmap|drawing`, gsrnamespace: '6', gsrlimit: String(PER_PAGE),
    gsroffset: String((page - 1) * PER_PAGE), prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: String(width),
    iiextmetadatafilter: 'Artist|Credit|LicenseShortName|UsageTerms|LicenseUrl|ObjectName|ImageDescription',
    format: 'json', formatversion: '2',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Wikimedia Commons didn’t answer (${res.status}).`);
  const data = await res.json() as { query?: { pages?: CommonsPage[] } };
  const pages = [...(data.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.flatMap((p, order): FoundPicture[] => {
    const info = p.imageinfo?.[0];
    if (!info) return [];
    const meta = info.extmetadata ?? {};
    const value = (key: string, max = 160) => plainText(meta[key]?.value, max);
    const original = String(info.mime ?? '');
    const vector = original === 'image/svg+xml';
    // SVG and TIFF files are downloaded as the rendered copy Commons makes.
    const rendered = vector || original === 'image/tiff';
    const url = https(info.thumburl) || (rendered ? '' : https(info.url));
    if (!url) return [];
    const mime = rendered ? (vector ? 'image/png' : 'image/jpeg') : original;
    const title = value('ObjectName') || String(p.title ?? '').replace(/^File:/, '').replace(/\.[a-z0-9]{2,4}$/i, '');
    return [{
      id: `commons:${p.pageid ?? p.title}`,
      provider: 'commons',
      title,
      thumb: https(info.thumburl).replace(/\/\d+px-/, '/330px-') || url,
      url,
      page: https(info.descriptionurl),
      width: Number(info.thumbwidth || info.width) || 0,
      height: Number(info.thumbheight || info.height) || 0,
      mime,
      author: value('Artist', 120) || value('Credit', 120),
      license: value('LicenseShortName', 60) || value('UsageTerms', 80),
      licenseUrl: https(value('LicenseUrl', 200)),
      text: value('ImageDescription', 300),
      order,
      ...(vector ? { vector: true } : {}),
    }];
  });
}

// ─── Pexels ───────────────────────────────────────────────────────────

async function searchPexels(q: string, page: number, shape: Shape): Promise<FoundPicture[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const orientation = shape === 'tall' ? 'portrait' : shape === 'square' ? 'square' : 'landscape';
  const params = new URLSearchParams({ query: q, per_page: String(PER_PAGE), page: String(page), orientation });
  const res = await fetch(`https://api.pexels.com/v1/search?${params}`, { headers: { authorization: key, 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new Error('The server’s Pexels key was rejected. Check PEXELS_API_KEY.');
  if (!res.ok) throw new Error(`Pexels didn’t answer (${res.status}).`);
  const data = await res.json() as { photos?: Record<string, unknown>[] };
  return (data.photos ?? []).flatMap((photo, order): FoundPicture[] => {
    const src = (photo.src ?? {}) as Record<string, string>;
    const url = https(src.large2x) || https(src.large) || https(src.original);
    if (!url) return [];
    const w = Number(photo.width) || 0;
    const h = Number(photo.height) || 0;
    // large2x is at most 1880 × 1300 (it keeps the proportions).
    const scale = w && h ? Math.min(1, 1880 / w, 1300 / h) : 1;
    return [{
      id: `pexels:${String(photo.id)}`,
      provider: 'pexels',
      title: plainText(photo.alt, 160),
      thumb: https(src.medium) || url,
      url,
      page: https(photo.url),
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      mime: 'image/jpeg',
      author: plainText(photo.photographer, 120),
      license: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      text: plainText(photo.alt, 300),
      order,
    }];
  });
}

// ─── Handler ──────────────────────────────────────────────────────────

export function providers(): PictureProvider[] {
  return ['openverse', 'commons', ...(process.env.PEXELS_API_KEY ? ['pexels' as const] : [])];
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!params.has('q')) return json({ providers: providers() }, 200, 'public, max-age=300');
  if (q.length < 2) return json({ error: 'Type a word or two to search for.' }, 400);
  const from = params.get('from') as PictureProvider;
  if (!providers().includes(from)) return json({ error: 'Pick a picture library: openverse, commons or pexels.' }, 400);
  const page = Math.max(1, Math.min(10, Math.floor(Number(params.get('page')) || 1)));
  const shape: Shape = (['wide', 'tall', 'square'] as const).find((s) => s === params.get('shape')) ?? 'wide';
  try {
    const results = from === 'openverse' ? await searchOpenverse(q, page) : from === 'commons' ? await searchCommons(q, page, shape) : await searchPexels(q, page, shape);
    // The same search gives the same pictures for a while; caching spares the libraries' rate limits.
    return json({ results }, 200, 'public, max-age=600, s-maxage=3600');
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const name = { openverse: 'Openverse', commons: 'Wikimedia Commons', pexels: 'Pexels' }[from];
    return json({ error: timedOut ? `${name} took too long to answer.` : error instanceof Error ? error.message : `${name} couldn’t be searched.` }, 502);
  }
}

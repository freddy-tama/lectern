// Web pages and live activities shown inside a slide.
//
// A web page is framed by its own address. Many sites offer a separate address
// for framing; the common ones are rewritten here. An activity is a complete
// HTML document (written by the AI or pasted) that runs in a sandbox: its own
// opaque origin, no access to Lectern's storage, and no network.

/** Content-Security-Policy for activities: inline code and data: media only, nothing fetched. */
export const ACTIVITY_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'";

/** iframe sandbox for activities. Scripts run; same-origin, pop-ups, navigation and dialogs don't. */
export const ACTIVITY_SANDBOX = 'allow-scripts allow-pointer-lock';

/** iframe sandbox for web pages, which run as their own origin. */
export const PAGE_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads';

/** Largest activity Lectern keeps on a slide. */
export const ACTIVITY_MAX = 200_000;

/**
 * The document an activity runs as: the HTML with the no-network policy at the top of its head.
 * A policy the HTML sets itself can only narrow this one.
 */
export function activityDocument(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ACTIVITY_CSP}">`;
  const body = String(html ?? '').slice(0, ACTIVITY_MAX);
  if (/<head[\s>]/i.test(body)) return body.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${meta}`);
  if (/<html[\s>]/i.test(body)) return body.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}<meta charset="utf-8"></head><body>${body}</body></html>`;
}

/** Pulls a full HTML document out of AI output or a paste: code fences and chatter around it are dropped. */
export function extractHtml(raw: string): string {
  const text = String(raw ?? '').trim();
  const fence = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text);
  const body = (fence ? fence[1] : text).trim();
  const start = body.search(/<!doctype html|<html[\s>]/i);
  const end = body.toLowerCase().lastIndexOf('</html>');
  if (start >= 0 && end > start) return body.slice(start, end + 7);
  return body;
}

/** Rough check that a paste is HTML worth running. */
export function looksLikeHtml(value: string): boolean {
  return /<(html|body|div|canvas|svg|script|style|button|main|section)[\s>]/i.test(value);
}

export interface PageEmbed {
  /** Address to frame. */
  src: string;
  /** Address people open themselves (link and QR code). */
  open: string;
  /** Site name for labels. */
  site: string;
}

/** Turns a page address into one that can be framed, for sites that need a different address. */
export function pageEmbed(value: unknown): PageEmbed | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const open = url.href;
  const site = host;
  const g = /^\/(presentation|document|spreadsheets|forms)\/d\/(e\/)?([^/]+)/.exec(url.pathname);
  if (host === 'docs.google.com' && g) {
    const [, type, published, id] = g;
    if (type === 'presentation') return { src: `https://docs.google.com/presentation/d/${published ?? ''}${id}/embed?start=false&loop=false`, open, site: 'Google Slides' };
    if (type === 'forms') return { src: `https://docs.google.com/forms/d/${published ?? ''}${id}/viewform?embedded=true`, open, site: 'Google Forms' };
    if (type === 'document') return { src: `https://docs.google.com/document/d/${published ?? ''}${id}/${published ? 'pub?embedded=true' : 'preview'}`, open, site: 'Google Docs' };
    return { src: `https://docs.google.com/spreadsheets/d/${published ?? ''}${id}/${published ? 'pubhtml?widget=true&headers=false' : 'preview'}`, open, site: 'Google Sheets' };
  }
  if (host === 'figma.com' && /^\/(file|design|proto|board)\//.test(url.pathname)) {
    return { src: `https://www.figma.com/embed?embed_host=lectern&url=${encodeURIComponent(open)}`, open, site: 'Figma' };
  }
  const geo = /^\/(?:m|material\/show\/id)\/([A-Za-z0-9]+)/.exec(url.pathname);
  if (host === 'geogebra.org' && geo) return { src: `https://www.geogebra.org/material/iframe/id/${geo[1]}`, open, site: 'GeoGebra' };
  const pen = /^\/([^/]+)\/pen\/([^/]+)/.exec(url.pathname);
  if (host === 'codepen.io' && pen) return { src: `https://codepen.io/${pen[1]}/embed/${pen[2]}?default-tab=result`, open, site: 'CodePen' };
  const loom = /^\/share\/([a-f0-9]+)/.exec(url.pathname);
  if (host === 'loom.com' && loom) return { src: `https://www.loom.com/embed/${loom[1]}`, open, site: 'Loom' };
  const canva = /^\/design\/([^/]+)\/([^/]+)/.exec(url.pathname);
  if (host === 'canva.com' && canva) return { src: `https://www.canva.com/design/${canva[1]}/${canva[2]}/view?embed`, open, site: 'Canva' };
  if (host === 'miro.com' && url.pathname.startsWith('/app/board/')) {
    return { src: `https://miro.com/app/live-embed/${url.pathname.split('/')[3]}/?embedMode=view_only_without_ui`, open, site: 'Miro' };
  }
  return { src: open, open, site };
}

/** A short form of an address for slides: host and path, no scheme or tracking. */
export function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    const out = `${url.hostname.replace(/^www\./, '')}${path}`;
    return out.length > 48 ? `${out.slice(0, 46)}…` : out;
  } catch {
    return value;
  }
}

/**
 * Keeps an SVG drawing safe to store and show: no scripts, event handlers, external
 * references or embedded HTML. Returns null when the text isn't an SVG.
 */
export function cleanSvg(raw: string): string | null {
  const text = String(raw ?? '').trim();
  const fence = /```(?:svg|xml)?\s*\n([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1] : text;
  const start = body.search(/<svg[\s>]/i);
  const end = body.toLowerCase().lastIndexOf('</svg>');
  if (start < 0 || end < start) return null;
  let svg = body.slice(start, end + 6);
  svg = svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("|')\s*(?!#|data:image\/(?:png|jpe?g|gif|webp);)[^"']*\1/gi, '')
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none')
    .replace(/@import[^;]*;?/gi, '');
  if (!/\sxmlns\s*=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

/** Width over height of an SVG, from its viewBox or size attributes. */
export function svgAspect(svg: string): number {
  const head = svg.slice(0, svg.indexOf('>') + 1);
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
  if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return Number(vb[1]) / Number(vb[2]);
  const w = Number(/\swidth\s*=\s*["']?([\d.]+)/i.exec(head)?.[1]);
  const h = Number(/\sheight\s*=\s*["']?([\d.]+)/i.exec(head)?.[1]);
  return w > 0 && h > 0 ? w / h : 0;
}

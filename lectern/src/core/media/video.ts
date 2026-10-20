// Video sources. A video slide holds one string: a stored file ("asset:<id>"),
// a direct link to a video file, or a YouTube or Vimeo page. This reads it.

export type VideoSource =
  | { provider: 'youtube'; id: string; start: number }
  | { provider: 'vimeo'; id: string; start: number }
  | { provider: 'file'; src: string };

/** "90", "1m30s", "1:30" or "1h2m" as seconds. */
export function parseTime(value: string | null | undefined): number {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return 0;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.floor(Number(v));
  if (/^\d+(:\d{1,2}){1,2}$/.test(v)) return v.split(':').map(Number).reduce((sum, n) => sum * 60 + n, 0);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(v);
  if (!m || !m[0]) return 0;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Reads a video reference. Returns null for an empty or unreadable value. */
export function parseVideo(value: unknown): VideoSource | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (raw.startsWith('asset:') || raw.startsWith('blob:') || /^data:video\//i.test(raw)) return { provider: 'file', src: raw };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, '').toLowerCase();
  const start = parseTime(url.searchParams.get('t') ?? url.searchParams.get('start') ?? (url.hash.match(/t=([^&]+)/)?.[1] ?? null));
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return YOUTUBE_ID.test(id) ? { provider: 'youtube', id, start } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v && YOUTUBE_ID.test(v)) return { provider: 'youtube', id: v, start };
    const m = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    return m ? { provider: 'youtube', id: m[1], start } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /\/(?:video\/)?(\d{5,})/.exec(url.pathname);
    return m ? { provider: 'vimeo', id: m[1], start } : null;
  }
  if (/\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(url.pathname)) return { provider: 'file', src: url.href };
  return null;
}

/** The player address for YouTube and Vimeo; the file itself for files. */
export function videoEmbedUrl(v: VideoSource, o: { autoplay?: boolean; start?: number; loop?: boolean; muted?: boolean } = {}): string {
  const start = Math.max(0, Math.floor(o.start ?? 0)) || (v.provider === 'file' ? 0 : v.start);
  if (v.provider === 'youtube') {
    const p = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1' });
    if (o.autoplay) p.set('autoplay', '1');
    if (o.muted) p.set('mute', '1');
    if (start) p.set('start', String(start));
    if (o.loop) { p.set('loop', '1'); p.set('playlist', v.id); }
    return `https://www.youtube-nocookie.com/embed/${v.id}?${p}`;
  }
  if (v.provider === 'vimeo') {
    const p = new URLSearchParams({ title: '0', byline: '0', portrait: '0' });
    if (o.autoplay) p.set('autoplay', '1');
    if (o.muted) p.set('muted', '1');
    if (o.loop) p.set('loop', '1');
    return `https://player.vimeo.com/video/${v.id}?${p}${start ? `#t=${start}s` : ''}`;
  }
  return start ? `${v.src}#t=${start}` : v.src;
}

/** A still for thumbnails. Only YouTube offers one without an API call. */
export function videoThumbnail(v: VideoSource | null): string {
  return v?.provider === 'youtube' ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : '';
}

/** The page people can open to watch, for exports and QR codes. Empty for stored files. */
export function videoWatchUrl(v: VideoSource | null): string {
  if (!v) return '';
  if (v.provider === 'youtube') return `https://youtu.be/${v.id}${v.start ? `?t=${v.start}` : ''}`;
  if (v.provider === 'vimeo') return `https://vimeo.com/${v.id}${v.start ? `#t=${v.start}s` : ''}`;
  return /^https?:\/\//i.test(v.src) ? v.src : '';
}

export function videoLabel(v: VideoSource | null): string {
  if (!v) return 'Video';
  return v.provider === 'youtube' ? 'YouTube video' : v.provider === 'vimeo' ? 'Vimeo video' : 'Video';
}

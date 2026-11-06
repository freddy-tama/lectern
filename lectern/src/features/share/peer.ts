// Creates WebRTC peers. A signalling server only introduces devices; slides, state
// and votes then travel directly between them (or through a TURN relay when a
// network blocks direct links). PeerJS's free public servers are the default.
//
// Why phones sometimes failed to join, and what this file does about it:
// - Some networks never let two devices reach each other directly: school and guest
//   Wi-Fi that isolates devices, and many mobile networks. Only a relay (TURN) gets
//   through there. The server can hand out relay details at /api/ice (api/ice.ts),
//   so a relay can be switched on in the hosting settings without a new build.
// - One public STUN server is a single point of failure, and Google's is blocked in
//   some countries: there are a few, from different providers.
// - The signalling server drops a computer whose heartbeat stops, and background
//   tabs slow timers to once a minute. keepAwake() ticks from a worker, which isn't
//   slowed, so the presenter's computer keeps answering.
//
// Optional settings (build-time environment variables):
//   VITE_PEER_HOST, VITE_PEER_PORT, VITE_PEER_PATH, VITE_PEER_KEY  your own PeerJS server
//   VITE_ICE_SERVERS  JSON array of RTCIceServer, to use your own STUN/TURN servers
//                     (this replaces the defaults and /api/ice)

import type { Peer, PeerOptions } from 'peerjs';

const env = import.meta.env as Record<string, string | undefined>;

/** STUN from three providers, and PeerJS's own free relay as the last resort. */
export const DEFAULT_ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

/** Whether a value is a list of ICE servers a browser would take. */
export function isIceList(value: unknown): value is RTCIceServer[] {
  return Array.isArray(value) && value.length > 0 && value.every((s) => {
    const urls = (s as RTCIceServer | null)?.urls;
    const list = Array.isArray(urls) ? urls : [urls];
    return list.length > 0 && list.every((u) => typeof u === 'string' && /^(stun|stuns|turn|turns):/.test(u));
  });
}

/**
 * The servers to use: a relay from /api/ice in front, when the server has one, then the
 * public STUN servers. Without a relay of its own, PeerJS's free one stays in.
 */
export function mergeIce(relay: RTCIceServer[] | null): RTCIceServer[] {
  if (!relay?.length) return DEFAULT_ICE;
  return [...relay, DEFAULT_ICE[0]!];
}

let iceCache: { at: number; ttl: number; servers: Promise<RTCIceServer[]> } | null = null;

/** Asks this site's server for relay details, once in a while. Never takes long, never fails. */
export function iceServers(): Promise<RTCIceServer[]> {
  if (env.VITE_ICE_SERVERS) {
    try {
      const own: unknown = JSON.parse(env.VITE_ICE_SERVERS);
      if (isIceList(own)) return Promise.resolve(own);
    } catch { /* fall through to the defaults */ }
  }
  const now = Date.now();
  if (iceCache && now - iceCache.at < iceCache.ttl) return iceCache.servers;
  const entry = { at: now, ttl: 5 * 60_000, servers: Promise.resolve(DEFAULT_ICE) };
  entry.servers = (async () => {
    if (typeof fetch === 'undefined') return DEFAULT_ICE;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2500);
    try {
      const res = await fetch('/api/ice', { signal: abort.signal, cache: 'no-store' });
      if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) return DEFAULT_ICE;
      const body = (await res.json()) as { iceServers?: unknown; ttl?: unknown };
      if (!isIceList(body.iceServers)) return DEFAULT_ICE;
      // Relay passwords expire: fetch new ones well before they do.
      if (typeof body.ttl === 'number' && body.ttl > 60) entry.ttl = Math.min(entry.ttl, (body.ttl * 1000) / 2);
      return mergeIce(body.iceServers);
    } catch {
      return DEFAULT_ICE;
    } finally {
      clearTimeout(timer);
    }
  })();
  iceCache = entry;
  return entry.servers;
}

/** Whether these servers include a relay of this site's own (not PeerJS's free one). */
export function hasOwnRelay(servers: RTCIceServer[]): boolean {
  return servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/.test(u) && !u.includes('turn.peerjs.com')));
}

async function options(): Promise<PeerOptions> {
  const opts: PeerOptions = { debug: 0 };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT) || 443;
    opts.path = env.VITE_PEER_PATH || '/';
    opts.secure = opts.port === 443;
    if (env.VITE_PEER_KEY) opts.key = env.VITE_PEER_KEY;
  }
  opts.config = { iceServers: await iceServers() };
  return opts;
}

/** Loads PeerJS on demand and opens a peer, resolving once the signalling server accepts it. */
export async function openPeer(id?: string, timeout = 15_000): Promise<Peer> {
  const [{ Peer: PeerClass }, opts] = await Promise.all([import('peerjs'), options()]);
  return new Promise((resolve, reject) => {
    const peer = id ? new PeerClass(id, opts) : new PeerClass(opts);
    const fail = (err: unknown) => { window.clearTimeout(timer); peer.destroy(); reject(err); };
    const timer = window.setTimeout(() => fail(Object.assign(new Error('timeout'), { type: 'network' })), timeout);
    // Failing is only for getting started. Once open, an error may be about one phone that left
    // halfway through connecting: it must not take down the link to everyone else.
    peer.once('open', () => { window.clearTimeout(timer); peer.off('error', fail); resolve(peer); });
    peer.once('error', fail);
  });
}

/**
 * Tells the signalling server this peer is still here. PeerJS does it on a timer that a
 * background tab slows down, so the server would drop the presenter's computer.
 */
export function heartbeat(peer: Peer | null) {
  const socket = (peer as unknown as { socket?: { send?(msg: { type: string }): void } } | null)?.socket;
  try { if (peer?.open) socket?.send?.({ type: 'HEARTBEAT' }); } catch { /* reconnecting */ }
}

/** The wait before retry number `attempt` (from 1): doubling from `base`, at most `cap`, with some jitter. */
export function backoff(attempt: number, base = 1000, cap = 15_000, random = Math.random): number {
  const plain = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(plain * (0.8 + random() * 0.4));
}

/**
 * Calls `tick` every `ms`, also while the tab is in the background. Timers in a worker
 * keep their pace there; the main thread's are slowed to once a minute.
 */
export function keepAwake(tick: () => void, ms: number): () => void {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.max(250, ms)});`], { type: 'text/javascript' }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = () => tick();
      return () => worker.terminate();
    } catch { /* workers blocked: use a plain timer */ }
  }
  const timer = window.setInterval(tick, ms);
  return () => window.clearInterval(timer);
}

/** Why a phone couldn't join, as far as it can tell. */
export type JoinTrouble = 'service' | 'missing' | 'blocked' | 'silent';

/** What to tell someone whose phone kept failing to join, by the last trouble seen. */
export function troubleMessage(trouble: JoinTrouble): string {
  switch (trouble) {
    case 'service': return 'Couldn’t reach the connection service. Check that this phone is online, then try again.';
    case 'missing': return 'No presentation is using that code right now. Check the code, or ask the presenter to share again.';
    case 'blocked': return 'This network won’t let your phone reach the presenter’s computer directly. Put both on the same Wi-Fi, or turn Wi-Fi off on your phone to use mobile data, then try again.';
    case 'silent': return 'The presenter’s computer didn’t answer. Make sure it’s still sharing, then try again.';
  }
}

/** The trouble a PeerJS error points to. */
export function troubleOf(err: unknown): JoinTrouble {
  const type = (err as { type?: string } | null)?.type;
  if (type === 'peer-unavailable') return 'missing';
  if (type === 'negotiation-failed' || type === 'webrtc') return 'blocked';
  return 'service';
}

/** A short explanation for a PeerJS error type. */
export function peerErrorMessage(err: unknown): string {
  const type = (err as { type?: string } | null)?.type;
  switch (type) {
    case 'peer-unavailable': return troubleMessage('missing');
    case 'browser-incompatible': return 'This browser can’t make live connections. Try Chrome, Safari or Edge.';
    case 'unavailable-id': return 'The connection service still holds this session’s code. Trying again…';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'disconnected': return 'Couldn’t reach the connection service. Check your internet connection and try again.';
    default: return 'The live connection didn’t work. Try again.';
  }
}

export function isSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

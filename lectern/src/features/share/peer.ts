// Creates WebRTC peers. A signalling server only introduces devices; slides, state
// and votes then travel directly between them (or through a TURN relay when a
// network blocks direct links). PeerJS's free public servers are the default.
//
// Optional settings (build-time environment variables):
//   VITE_PEER_HOST, VITE_PEER_PORT, VITE_PEER_PATH, VITE_PEER_KEY  your own PeerJS server
//   VITE_ICE_SERVERS  JSON array of RTCIceServer, to use your own STUN/TURN servers

import type { Peer, PeerOptions } from 'peerjs';

const env = import.meta.env as Record<string, string | undefined>;

function options(): PeerOptions {
  const opts: PeerOptions = { debug: 0 };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT) || 443;
    opts.path = env.VITE_PEER_PATH || '/';
    opts.secure = opts.port === 443;
    if (env.VITE_PEER_KEY) opts.key = env.VITE_PEER_KEY;
  }
  if (env.VITE_ICE_SERVERS) {
    try { opts.config = { iceServers: JSON.parse(env.VITE_ICE_SERVERS) as RTCIceServer[] }; } catch { /* keep the defaults */ }
  }
  return opts;
}

/** Loads PeerJS on demand and opens a peer, resolving once the signalling server accepts it. */
export async function openPeer(id?: string): Promise<Peer> {
  const { Peer: PeerClass } = await import('peerjs');
  return new Promise((resolve, reject) => {
    const peer = id ? new PeerClass(id, options()) : new PeerClass(options());
    const fail = (err: unknown) => { peer.destroy(); reject(err); };
    const timer = window.setTimeout(() => fail(Object.assign(new Error('timeout'), { type: 'network' })), 15_000);
    peer.once('open', () => { window.clearTimeout(timer); peer.off('error', fail); resolve(peer); });
    peer.once('error', (err) => { window.clearTimeout(timer); fail(err); });
  });
}

/** A short explanation for a PeerJS error type. */
export function peerErrorMessage(err: unknown): string {
  const type = (err as { type?: string } | null)?.type;
  switch (type) {
    case 'peer-unavailable': return 'No presentation is using that code right now. Check the code, or ask the presenter to share again.';
    case 'browser-incompatible': return 'This browser can’t make live connections. Try Chrome, Safari or Edge.';
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

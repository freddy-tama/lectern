// Share to phones, staying connected: relay settings, waits between tries, and a phone
// that joins and rejoins through a stand-in for PeerJS.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, cleanServers, relayServers, resetRelayCache, staticServers } from '../api/ice';
import { SILENT_AFTER } from '../src/core/share/protocol';
import { db } from '../src/data/db';
import { buildSeed } from '../src/data/seed';
import { DEFAULT_ICE, backoff, hasOwnRelay, isIceList, mergeIce, troubleMessage, troubleOf } from '../src/features/share/peer';

// ─── A stand-in for PeerJS ────────────────────────────────────────────

type Handler = (...args: unknown[]) => void;

class Emitter {
  private handlers = new Map<string, Handler[]>();
  on(event: string, fn: Handler) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]); return this; }
  removeAllListeners(event?: string) { if (event) this.handlers.delete(event); else this.handlers.clear(); return this; }
  emit(event: string, ...args: unknown[]) { for (const fn of this.handlers.get(event) ?? []) fn(...args); }
}

class FakeConn extends Emitter {
  open = false;
  closed = false;
  sent: unknown[] = [];
  constructor(readonly peer: string, readonly metadata: unknown) { super(); }
  send(msg: unknown) { this.sent.push(msg); }
  close() { if (this.closed) return; this.closed = true; this.open = false; this.emit('close'); }
  /** The computer answers. */
  accept() { this.open = true; this.emit('open'); }
  hear(msg: unknown) { this.emit('data', msg); }
}

class FakePeer extends Emitter {
  open = true;
  destroyed = false;
  disconnected = false;
  conns: FakeConn[] = [];
  reconnects = 0;
  reconnect() { this.reconnects += 1; this.disconnected = false; }
  connect(id: string, opts: { metadata: unknown }) {
    const c = new FakeConn(id, opts.metadata);
    this.conns.push(c);
    return c;
  }
  destroy() { this.destroyed = true; }
}

const peers: FakePeer[] = [];
let openFails = 0;

vi.mock('../src/features/share/peer', async (original) => ({
  ...(await original<typeof import('../src/features/share/peer')>()),
  openPeer: vi.fn(async () => {
    if (openFails > 0) {
      openFails -= 1;
      throw Object.assign(new Error('socket'), { type: 'network' });
    }
    const p = new FakePeer();
    peers.push(p);
    return p;
  }),
}));

const { liveLink } = await import('../src/features/share/guest');
const { liveHost } = await import('../src/features/share/host');

/** The newest link the phone opened. */
function lastConn(): FakeConn {
  const all = peers.flatMap((p) => p.conns);
  return all[all.length - 1]!;
}

/** Lets promises and the database settle while fake timers hold still. */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

async function welcomeSame(c: FakeConn) {
  c.accept();
  c.hear({ t: 'welcome', role: 'audience', title: 'Deck', parts: 0, bytes: 0, same: true });
  await settle();
}

// ─── Relay settings (api/ice.ts) ──────────────────────────────────────

describe('relay details from the server', () => {
  beforeEach(() => resetRelayCache());

  it('keeps valid servers only, never on port 53, and relays only with a password', () => {
    expect(cleanServers([
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp', 'turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' },
      { urls: 'turn:nopassword.example.com:3478' },
      { urls: 'https://not-ice.example.com' },
    ])).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ]);
    // Cloudflare's older answer is one object rather than a list.
    expect(cleanServers({ urls: ['turn:a.example.com:3478'], username: 'u', credential: 'c' })).toHaveLength(1);
  });

  it('reads a fixed relay from the settings', () => {
    expect(staticServers({ TURN_URLS: 'turn:relay.example.com:3478, turns:relay.example.com:443?transport=tcp', TURN_USERNAME: 'me', TURN_CREDENTIAL: 'pw' }))
      .toEqual([{ urls: ['turn:relay.example.com:3478', 'turns:relay.example.com:443?transport=tcp'], username: 'me', credential: 'pw' }]);
    expect(staticServers({})).toEqual([]);
  });

  it('asks Cloudflare for short-lived passwords, and keeps them for a while', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ iceServers: [{ urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'x', credential: 'y' }] }), { status: 200 }));
    const env = { CLOUDFLARE_TURN_KEY_ID: 'key', CLOUDFLARE_TURN_API_TOKEN: 'token' };
    const first = await relayServers(env, fetcher as unknown as typeof fetch, 1000);
    const again = await relayServers(env, fetcher as unknown as typeof fetch, 2000);
    expect(first).toEqual(again);
    expect(first[0]!.username).toBe('x');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/turn/keys/key/credentials/generate-ice-servers');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token');
  });

  it('falls back to a fixed relay when Cloudflare fails', async () => {
    const fetcher = vi.fn(async () => new Response('no', { status: 500 }));
    const servers = await relayServers({ CLOUDFLARE_TURN_KEY_ID: 'k', CLOUDFLARE_TURN_API_TOKEN: 't', TURN_URLS: 'turn:r.example.com:3478', TURN_USERNAME: 'a', TURN_CREDENTIAL: 'b' }, fetcher as unknown as typeof fetch, 0);
    expect(servers).toEqual([{ urls: ['turn:r.example.com:3478'], username: 'a', credential: 'b' }]);
  });

  it('answers with no servers when none are set, so browsers keep their defaults', async () => {
    const keep = { ...process.env };
    for (const k of ['CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN', 'TURN_URLS']) delete process.env[k];
    try {
      const body = await (await GET()).json();
      expect(body).toMatchObject({ iceServers: [], relay: false });
    } finally {
      process.env = keep;
    }
  });
});

describe('servers and waits in the browser', () => {
  it('puts the site’s relay first, and keeps PeerJS’s free one only without it', () => {
    expect(isIceList(DEFAULT_ICE)).toBe(true);
    expect(isIceList([])).toBe(false);
    expect(isIceList([{ urls: 'http://x' }])).toBe(false);
    expect(mergeIce(null)).toBe(DEFAULT_ICE);
    const own = [{ urls: ['turns:relay.example.com:443?transport=tcp'], username: 'a', credential: 'b' }];
    const merged = mergeIce(own);
    expect(merged[0]).toBe(own[0]);
    expect(JSON.stringify(merged)).not.toContain('peerjs.com');
    expect(hasOwnRelay(merged)).toBe(true);
    expect(hasOwnRelay(DEFAULT_ICE)).toBe(false);
  });

  it('waits longer after each failed try, up to a limit, with a little jitter', () => {
    const mid = () => 0.5;
    expect(backoff(1, 1000, 15_000, mid)).toBe(1000);
    expect(backoff(2, 1000, 15_000, mid)).toBe(2000);
    expect(backoff(3, 1000, 15_000, mid)).toBe(4000);
    expect(backoff(12, 1000, 15_000, mid)).toBe(15_000);
    expect(backoff(1, 1000, 15_000, () => 0)).toBe(800);
    expect(backoff(1, 1000, 15_000, () => 0.999)).toBeLessThanOrEqual(1200);
  });

  it('names the trouble behind a failed join', () => {
    expect(troubleOf({ type: 'peer-unavailable' })).toBe('missing');
    expect(troubleOf({ type: 'negotiation-failed' })).toBe('blocked');
    expect(troubleOf({ type: 'network' })).toBe('service');
    expect(troubleMessage('blocked')).toMatch(/same Wi-Fi|mobile data/);
  });
});

// ─── A phone joining ──────────────────────────────────────────────────

describe('a phone joining and staying joined', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    peers.length = 0;
    openFails = 0;
    await db.settings.put({ key: 'link:ABC234', value: { deckId: 'shared_d1', updatedAt: 1 } });
  });

  afterEach(() => {
    liveLink.leave();
    vi.useRealTimers();
  });

  it('tries again when the first try can’t reach the service, instead of showing an error', async () => {
    openFails = 1;
    liveLink.join('ABC234');
    await settle();
    expect(liveLink.snapshot.status).toBe('connecting');
    expect(liveLink.snapshot.attempt).toBe(1);
    expect(liveLink.snapshot.trouble).toBe('service');
    await settle(3000);
    expect(peers).toHaveLength(1);
    await welcomeSame(lastConn());
    expect(liveLink.snapshot.status).toBe('ready');
    expect(liveLink.snapshot.attempt).toBe(0);
  });

  it('tries again when the presentation isn’t found yet', async () => {
    liveLink.join('ABC234');
    await settle();
    peers[0]!.emit('error', { type: 'peer-unavailable' });
    expect(liveLink.snapshot.trouble).toBe('missing');
    expect(liveLink.snapshot.status).toBe('connecting');
    await settle(3000);
    // The service says "missing" once per peer: the next try asks with a fresh one.
    expect(peers[0]!.destroyed).toBe(true);
    expect(peers).toHaveLength(2);
    await welcomeSame(lastConn());
    expect(liveLink.snapshot.status).toBe('ready');
  });

  it('blames a missing code, not the network, when tries that heard nothing follow one that heard “missing”', async () => {
    liveLink.join('ABC234');
    await settle();
    peers[0]!.emit('error', { type: 'peer-unavailable' });
    for (let i = 0; i < 3; i++) await settle(16_000 + 3000);
    expect(liveLink.snapshot.status).toBe('error');
    expect(liveLink.snapshot.trouble).toBe('missing');
    expect(liveLink.snapshot.error).toMatch(/No presentation is using that code/);
  });

  it('gives up after a few tries with what went wrong, and starts over on Try again', async () => {
    liveLink.join('ABC234');
    await settle();
    // Each try's link never opens: the network blocks it.
    for (let i = 0; i < 4; i++) await settle(16_000 + 3000);
    expect(liveLink.snapshot.status).toBe('error');
    expect(liveLink.snapshot.trouble).toBe('blocked');
    expect(liveLink.snapshot.error).toMatch(/network/);
    liveLink.retry();
    await settle();
    expect(liveLink.snapshot.status).toBe('connecting');
    expect(liveLink.snapshot.attempt).toBe(0);
  });

  it('answers pings, and rejoins when the computer goes quiet', async () => {
    liveLink.join('ABC234');
    await settle();
    const first = lastConn();
    await welcomeSame(first);
    first.hear({ t: 'ping', at: 5 });
    expect(first.sent).toContainEqual({ t: 'pong', at: 5 });
    await settle(SILENT_AFTER + 3500);
    expect(liveLink.snapshot.status).toBe('reconnecting');
    expect(first.closed).toBe(true);
    await settle(1500);
    const second = lastConn();
    expect(second).not.toBe(first);
    await welcomeSame(second);
    expect(liveLink.snapshot.status).toBe('ready');
  });

  it('keeps trying after a dropped link instead of ending, and ends on goodbye', async () => {
    liveLink.join('ABC234');
    await settle();
    await welcomeSame(lastConn());
    for (let i = 0; i < 15; i++) {
      lastConn().close();
      await settle(13_000);
    }
    expect(liveLink.snapshot.status).toBe('reconnecting');
    await welcomeSame(lastConn());
    expect(liveLink.snapshot.status).toBe('ready');
    lastConn().hear({ t: 'bye' });
    expect(liveLink.snapshot.status).toBe('ended');
  });

  it('opens a fresh peer when the old one lost the service', async () => {
    liveLink.join('ABC234');
    await settle();
    await welcomeSame(lastConn());
    peers[0]!.disconnected = true;
    lastConn().close();
    await settle(1500);
    expect(peers).toHaveLength(2);
    expect(peers[0]!.destroyed).toBe(true);
  });
});

// ─── The presenter's computer ─────────────────────────────────────────

describe('the computer staying reachable', () => {
  const deck = buildSeed(new Date('2026-10-19T10:00:00')).decks[0]!;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    peers.length = 0;
    openFails = 0;
    await db.decks.put(deck);
  });

  afterEach(async () => {
    liveHost.stop();
    await settle(1000);
    vi.useRealTimers();
  });

  async function share() {
    await liveHost.start(deck.id);
    await settle();
    expect(liveHost.snapshot.status).toBe('live');
    return peers[0]!;
  }

  it('reconnects to the service with growing waits, not over and over at once', async () => {
    const peer = await share();
    peer.disconnected = true;
    peer.emit('disconnected');
    expect(liveHost.snapshot.signal).toBe('down');
    expect(peer.reconnects).toBe(0);
    await settle(1300);
    expect(peer.reconnects).toBe(1);
    // The code is still held by the service: the next try waits longer.
    peer.disconnected = true;
    peer.emit('error', { type: 'unavailable-id' });
    peer.emit('disconnected');
    await settle(1300);
    expect(peer.reconnects).toBe(1);
    await settle(1500);
    expect(peer.reconnects).toBe(2);
    expect(liveHost.snapshot.error).toBeNull();
    peer.emit('open');
    expect(liveHost.snapshot.signal).toBe('up');
  });

  it('pings phones, and lets go of one that stopped answering', async () => {
    const peer = await share();
    const phone = new FakeConn('phone-1', { device: 'iPhone', player: 'p1' });
    peer.emit('connection', phone);
    phone.accept();
    await settle(100);
    expect(liveHost.snapshot.guests.map((g) => g.ready)).toEqual([true]);
    await settle(4100);
    const ping = phone.sent.find((m) => (m as { t: string }).t === 'ping') as { at: number };
    expect(ping).toBeTruthy();
    phone.hear({ t: 'pong', at: ping.at });
    await settle(50_000);
    expect(liveHost.snapshot.guests).toEqual([]);
    expect(phone.closed).toBe(true);
  });

  it('keeps phones from older versions that never answer pings', async () => {
    const peer = await share();
    const phone = new FakeConn('phone-2', { device: 'Android phone', player: 'p2' });
    peer.emit('connection', phone);
    phone.accept();
    await settle(60_000);
    expect(liveHost.snapshot.guests).toHaveLength(1);
  });

  it('shows a phone that rejoins once, not twice', async () => {
    const peer = await share();
    const first = new FakeConn('phone-a', { device: 'iPhone', player: 'same' });
    peer.emit('connection', first);
    first.accept();
    await settle(100);
    const again = new FakeConn('phone-b', { device: 'iPhone', player: 'same' });
    peer.emit('connection', again);
    again.accept();
    await settle(100);
    expect(liveHost.snapshot.guests.map((g) => g.id)).toEqual(['phone-b']);
    expect(first.closed).toBe(true);
  });
});

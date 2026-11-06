// Share to phones, staying connected: relay settings, waits between tries, and a phone
// that joins and rejoins through a stand-in for PeerJS.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, cleanServers, relayServers, resetRelayCache, staticServers } from '../api/ice';
import { emptyNotes } from '../src/core/deck/types';
import { AWAY_FOR, SILENT_AFTER, WEAK_AFTER } from '../src/core/share/protocol';
import { db } from '../src/data/db';
import { buildSeed } from '../src/data/seed';
import { DEFAULT_ICE, backoff, hasOwnRelay, isIceList, mergeIce, troubleMessage, troubleOf } from '../src/features/share/peer';
import { SESSION_MAX } from '../src/features/share/session-store';

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
    for (let i = 0; i < 6; i++) await settle(21_000 + 3000);
    expect(liveLink.snapshot.status).toBe('error');
    expect(liveLink.snapshot.trouble).toBe('missing');
    expect(liveLink.snapshot.error).toMatch(/No presentation is using that code/);
  });

  it('says what went wrong after a few tries, and starts over on Try again', async () => {
    liveLink.join('ABC234');
    await settle();
    // Each try's link never opens: the network blocks it.
    for (let i = 0; i < 6; i++) await settle(21_000 + 3000);
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

// ─── Keeping what a student did, through drops and reloads ────────────

describe('a phone keeping its answers', () => {
  const CODE = 'DEF234';

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    peers.length = 0;
    openFails = 0;
    localStorage.clear();
    await db.settings.put({ key: `link:${CODE}`, value: { deckId: 'shared_d2', updatedAt: 1 } });
    await db.decks.put({ ...buildSeed(new Date('2026-10-19T10:00:00')).decks[0]!, id: 'shared_d2' });
  });

  afterEach(async () => {
    liveLink.leave();
    await db.decks.delete('shared_d2');
    await db.settings.delete(`link:${CODE}`);
    vi.useRealTimers();
  });

  async function joined() {
    liveLink.join(CODE);
    await settle();
    const c = lastConn();
    c.accept();
    c.hear({ t: 'welcome', role: 'audience', title: 'Deck', parts: 0, bytes: 0, same: true, acks: true });
    await settle();
    expect(liveLink.snapshot.status).toBe('ready');
    return c;
  }

  it('holds an answer tapped while the link is down, and sends it on reconnecting, saying how long ago', async () => {
    const first = await joined();
    first.close();
    expect(liveLink.snapshot.status).toBe('reconnecting');
    liveLink.answer('q1', 2);
    expect(liveLink.snapshot.myAnswers.q1).toBe(2);
    expect(liveLink.snapshot.outbox).toHaveLength(1);
    await settle(5000);
    const second = lastConn();
    expect(second).not.toBe(first);
    second.accept();
    second.hear({ t: 'welcome', role: 'audience', title: 'Deck', parts: 0, bytes: 0, same: true, acks: true });
    await settle();
    const sent = second.sent.find((m) => (m as { t: string }).t === 'answer') as { choice: number; ago: number };
    expect(sent.choice).toBe(2);
    expect(sent.ago).toBeGreaterThanOrEqual(5000);
    // Still held until the computer says it has it.
    expect(liveLink.snapshot.outbox).toHaveLength(1);
    second.hear({ t: 'mine', answers: { q1: 2 }, votes: {}, words: {} });
    expect(liveLink.snapshot.outbox).toEqual([]);
  });

  it('sends an unconfirmed answer again on a link that only looks fine', async () => {
    const c = await joined();
    liveLink.answer('q1', 1);
    const count = () => c.sent.filter((m) => (m as { t: string }).t === 'answer').length;
    expect(count()).toBe(1);
    await settle(7000);
    expect(count()).toBeGreaterThan(1);
    c.hear({ t: 'mine', answers: { q1: 1 }, votes: {}, words: {} });
    const after = count();
    await settle(7000);
    expect(count()).toBe(after);
  });

  it('remembers answers through a reload, and shows the saved deck straight away', async () => {
    await joined();
    liveLink.answer('q1', 0);
    liveLink.vote('p1', 1);
    // What a reload does: everything in memory goes, and the page joins again.
    liveLink.leave();
    expect(liveLink.snapshot.myAnswers).toEqual({});
    liveLink.join(CODE);
    expect(liveLink.snapshot.myAnswers).toEqual({ q1: 0 });
    expect(liveLink.snapshot.myVotes).toEqual({ p1: 1 });
    expect(liveLink.snapshot.outbox).toHaveLength(2);
    await settle();
    expect(liveLink.snapshot.status).toBe('reconnecting');
    expect(liveLink.snapshot.deckId).toBe('shared_d2');
  });

  it('takes the computer’s word for what counted, and says when an answer came too late', async () => {
    const c = await joined();
    liveLink.answer('q1', 0);
    liveLink.answer('q2', 2);
    c.hear({ t: 'mine', answers: { q1: 1 }, votes: {}, words: {}, refused: ['q2'] });
    // The computer had a different answer from before: that one stands.
    expect(liveLink.snapshot.myAnswers).toEqual({ q1: 1 });
    expect(liveLink.snapshot.outbox).toEqual([]);
    expect(liveLink.snapshot.late).toEqual({ q2: true });
  });

  it('lets a question be answered again after the presenter starts the quiz over', async () => {
    const c = await joined();
    liveLink.answer('q1', 0);
    c.hear({ t: 'mine', answers: { q1: 0 }, votes: {}, words: {} });
    c.hear({ t: 'mine', answers: {}, votes: {}, words: {} });
    expect(liveLink.snapshot.myAnswers).toEqual({});
  });

  it('doesn’t end when the computer goes missing for a long time, and comes back when it does', async () => {
    const c = await joined();
    c.close();
    for (let i = 0; i < 8; i++) {
      peers[peers.length - 1]!.emit('error', { type: 'peer-unavailable' });
      await settle(30_000);
    }
    expect(liveLink.snapshot.status).toBe('reconnecting');
    expect(liveLink.snapshot.trouble).toBe('missing');
    const back = lastConn();
    back.accept();
    back.hear({ t: 'welcome', role: 'audience', title: 'Deck', parts: 0, bytes: 0, same: true, acks: true });
    await settle();
    expect(liveLink.snapshot.status).toBe('ready');
  });

  it('stops trying when the same phone opened the deck elsewhere, until asked', async () => {
    const c = await joined();
    c.hear({ t: 'replaced' });
    expect(liveLink.snapshot.status).toBe('replaced');
    const opened = peers.flatMap((p) => p.conns).length;
    await settle(60_000);
    expect(peers.flatMap((p) => p.conns).length).toBe(opened);
    liveLink.retry();
    await settle();
    expect(peers.flatMap((p) => p.conns).length).toBe(opened + 1);
  });

  it('tries again straight away on Try now', async () => {
    const c = await joined();
    c.close();
    expect(liveLink.snapshot.status).toBe('reconnecting');
    const opened = peers.flatMap((p) => p.conns).length;
    liveLink.tryNow();
    await settle();
    expect(peers.flatMap((p) => p.conns).length).toBe(opened + 1);
  });

  it('takes a fresh peer after hearing the computer is missing: a second offer from the old one hears nothing', async () => {
    const c = await joined();
    c.close();
    await settle(2000);
    const old = peers[peers.length - 1]!;
    const before = peers.length;
    old.emit('error', { type: 'peer-unavailable' });
    expect(old.destroyed).toBe(true);
    await settle(2500);
    expect(peers.length).toBe(before + 1);
  });

  it('starts afresh when the network comes back, rather than wait for a try that may be dead', async () => {
    const c = await joined();
    c.close();
    await settle(2000);
    const before = peers.length;
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(peers.length).toBe(before + 1);
  });

  it('gives up on a try from before the phone slept when it’s back on screen', async () => {
    const c = await joined();
    c.close();
    await settle(2000);
    const before = peers.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(peers.length).toBe(before);
    await settle(6000);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(peers.length).toBe(before + 1);
  });

  it('notices a computer that goes quiet before its first ping', async () => {
    await joined();
    await settle(SILENT_AFTER + 3100);
    expect(liveLink.snapshot.status).toBe('reconnecting');
  });

  it('stays on an older computer that never pings', async () => {
    liveLink.join(CODE);
    await settle();
    await welcomeSame(lastConn());
    await settle(SILENT_AFTER + 3100);
    expect(liveLink.snapshot.status).toBe('ready');
  });

  it('says the signal is weak before it gives up on the link', async () => {
    const c = await joined();
    c.hear({ t: 'ping', at: 1 });
    await settle(WEAK_AFTER + 3100);
    expect(liveLink.snapshot.weak).toBe(true);
    expect(liveLink.snapshot.status).toBe('ready');
    c.hear({ t: 'ping', at: 2 });
    await settle(3100);
    expect(liveLink.snapshot.weak).toBe(false);
  });

  it('keeps joining by itself after it has shown an error', async () => {
    await db.settings.delete(`link:${CODE}`);
    liveLink.join(CODE);
    await settle();
    for (let i = 0; i < 6; i++) await settle(21_000 + 3000);
    expect(liveLink.snapshot.status).toBe('error');
    await settle(25_000);
    await settle(1000);
    const c = lastConn();
    c.accept();
    c.hear({ t: 'welcome', role: 'audience', title: 'Deck', parts: 1, bytes: 1 });
    expect(liveLink.snapshot.status).toBe('receiving');
    expect(liveLink.snapshot.error).toBeNull();
  });
});

// ─── The computer through drops and reloads ───────────────────────────

describe('the computer through drops and reloads', () => {
  const deck = buildSeed(new Date('2026-10-19T10:00:00')).decks[0]!;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    peers.length = 0;
    openFails = 0;
    localStorage.clear();
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
    return peers[0]!;
  }

  function phone(peer: FakePeer, id: string, player: string) {
    const c = new FakeConn(id, { device: 'iPhone', player });
    peer.emit('connection', c);
    c.accept();
    return c;
  }

  it('tells an older copy of a phone it was replaced, so the two don’t fight', async () => {
    const peer = await share();
    const first = phone(peer, 'tab-1', 'same');
    await settle(100);
    const second = phone(peer, 'tab-2', 'same');
    await settle(100);
    expect(first.sent).toContainEqual({ t: 'replaced' });
    expect(second.sent).not.toContainEqual({ t: 'replaced' });
    expect(liveHost.snapshot.guests.map((g) => g.id)).toEqual(['tab-2']);
  });

  it('shows a phone that lost its link as reconnecting, then one row when it is back', async () => {
    const peer = await share();
    const first = phone(peer, 'link-1', 'stu');
    await settle(100);
    first.close();
    expect(liveHost.snapshot.guests).toHaveLength(1);
    expect(liveHost.snapshot.guests[0]!.awaySince).toBeDefined();
    phone(peer, 'link-2', 'stu');
    await settle(100);
    expect(liveHost.snapshot.guests.map((g) => [g.id, g.awaySince])).toEqual([['link-2', undefined]]);
  });

  it('takes a phone off the list when it doesn’t come back', async () => {
    const peer = await share();
    phone(peer, 'link-1', 'stu').close();
    await settle(AWAY_FOR + 5000);
    expect(liveHost.snapshot.guests).toEqual([]);
  });

  it('confirms answers, and counts one taken while the phone’s link was down from when it was tapped', async () => {
    const peer = await share();
    const c = phone(peer, 'link-1', 'stu');
    await settle(300);
    const mine = () => c.sent.filter((m) => (m as { t: string }).t === 'mine').pop() as { answers: Record<string, number>; refused?: string[] };
    expect(mine()).toMatchObject({ answers: {}, votes: {}, words: {} });
    // No question is open, so this answer can't count, and the phone is told.
    c.hear({ t: 'answer', slideId: 'nothing', choice: 0, ago: 500 });
    expect(mine().refused).toEqual(['nothing']);
  });

  it('counts a phone that reconnected and changed its vote once', async () => {
    const poll = { id: 'poll', kind: 'question', content: { question: 'Which?', options: ['A', 'B'] }, notes: emptyNotes() };
    await db.decks.put({ ...deck, slides: [poll] });
    const peer = await share();
    const first = phone(peer, 'link-1', 'stu');
    await settle(100);
    first.hear({ t: 'vote', slideId: 'poll', choice: 0 });
    first.close();
    const second = phone(peer, 'link-2', 'stu');
    await settle(100);
    second.hear({ t: 'vote', slideId: 'poll', choice: 1 });
    expect(liveHost.snapshot.votes.poll).toEqual({ counts: [0, 1], total: 1 });
    await db.decks.put(deck);
  });

  it('picks the session up after a reload: same code and token, scores and answers kept', async () => {
    const quizSlide = { id: 'q1', kind: 'question', content: { question: 'Which?', options: ['A', 'B'], correct: 1 }, notes: emptyNotes() };
    await db.decks.put({ ...deck, slides: [quizSlide] });
    const peer = await share();
    const { code, token } = liveHost.snapshot;
    const c = phone(peer, 'link-1', 'stu');
    await settle(100);
    liveHost.setState({ index: 0, step: 0, blank: false, flags: {}, startedAt: null });
    c.hear({ t: 'answer', slideId: 'q1', choice: 1, ago: 0 });
    liveHost.keepNow();
    const key = `lectern.share.session.${code}`;
    const saved = localStorage.getItem(key)!;
    expect(saved).toBeTruthy();
    // What a reload does: the page is gone, what it wrote down stays. (stop() also clears it.)
    liveHost.stop();
    await settle(1000);
    expect(localStorage.getItem(key)).toBeNull();
    localStorage.setItem(key, saved);
    const before = peers.length;
    expect(await liveHost.resume()).toBe(true);
    expect(liveHost.snapshot).toMatchObject({ status: 'live', code, token, resumed: true });
    expect(liveHost.quizResults().questions[0]!.choicesBy).toEqual({ stu: 1 });
    expect(liveHost.snapshot.state?.index).toBe(0);
    await settle();
    expect(peers.length).toBe(before + 1);
    expect(liveHost.snapshot.signal).toBe('up');
    // The phone comes back, and is told what it already answered.
    const back = phone(peers[peers.length - 1]!, 'link-2', 'stu');
    await settle(100);
    expect(back.sent.filter((m) => (m as { t: string }).t === 'mine').pop()).toMatchObject({ answers: { q1: 1 } });
    await db.decks.put(deck);
  });

  it('keeps trying for the code after a reload until the service gives it back', async () => {
    await db.decks.put(deck);
    await share();
    const { code } = liveHost.snapshot;
    liveHost.keepNow();
    const key = `lectern.share.session.${code}`;
    const saved = localStorage.getItem(key)!;
    liveHost.stop();
    await settle(1000);
    localStorage.setItem(key, saved);
    openFails = 3;
    await liveHost.resume();
    await settle(1000);
    expect(liveHost.snapshot.signal).toBe('down');
    await settle(30_000);
    expect(liveHost.snapshot.signal).toBe('up');
    expect(liveHost.snapshot.code).toBe(code);
  });

  it('forgets the session on Stop sharing, and doesn’t pick up an old one', async () => {
    await share();
    const { code } = liveHost.snapshot;
    liveHost.keepNow();
    const key = `lectern.share.session.${code}`;
    const saved = JSON.parse(localStorage.getItem(key)!) as { at: number };
    liveHost.stop();
    await settle(1000);
    expect(await liveHost.resume()).toBe(false);
    localStorage.setItem(key, JSON.stringify({ ...saved, at: Date.now() - SESSION_MAX - 1000 }));
    expect(await liveHost.resume()).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
  });
});

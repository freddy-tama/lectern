// Opening a link to the connection service, through a stand-in for PeerJS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPeer } from '../src/features/share/peer';

const { FakePeer, made } = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const made: FakePeer[] = [];
  /** Removes listeners the way PeerJS's emitter does: by the very function it was given. */
  class FakePeer {
    destroyed = false;
    private handlers: { event: string; fn: Handler; once: boolean }[] = [];
    constructor() { made.push(this); }
    once(event: string, fn: Handler) { this.handlers.push({ event, fn, once: true }); return this; }
    off(event: string, fn: Handler) { this.handlers = this.handlers.filter((h) => h.event !== event || h.fn !== fn); return this; }
    emit(event: string, ...args: unknown[]) {
      for (const h of this.handlers.filter((x) => x.event === event)) {
        if (h.once) this.handlers = this.handlers.filter((x) => x !== h);
        h.fn(...args);
      }
    }
    destroy() { this.destroyed = true; }
  }
  return { FakePeer, made };
});

vi.mock('peerjs', () => ({ Peer: FakePeer }));

async function started() {
  await vi.waitFor(() => expect(made).toHaveLength(1));
  return made[0]!;
}

describe('opening a link to the connection service', () => {
  beforeEach(() => {
    made.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps the link when a phone leaves halfway through connecting', async () => {
    const opening = openPeer('lectern-ABC234');
    const peer = await started();
    peer.emit('open');
    await opening;
    // The service says this when the computer answers a phone that has already gone.
    peer.emit('error', { type: 'peer-unavailable' });
    expect(peer.destroyed).toBe(false);
  });

  it('fails when the service refuses before the link is open', async () => {
    const opening = openPeer('lectern-ABC234');
    const peer = await started();
    peer.emit('error', { type: 'unavailable-id' });
    await expect(opening).rejects.toMatchObject({ type: 'unavailable-id' });
    expect(peer.destroyed).toBe(true);
  });

  it('gives up when the service doesn’t answer in time', async () => {
    const opening = openPeer(undefined, 20);
    await expect(opening).rejects.toMatchObject({ type: 'network' });
    expect((await started()).destroyed).toBe(true);
  });
});

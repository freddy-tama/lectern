// Keeps the audience window, presenter view and teleprompter on the same slide.
// Uses BroadcastChannel, so it works across windows of this browser with no server.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

export interface ShowState {
  index: number;
  step: number;
  blank: boolean;
  flags: Record<string, boolean>;
  /** When the talk started (ms), shared so every window shows the same timer. */
  startedAt: number | null;
}

type Message =
  | { type: 'state'; from: string; state: ShowState; at: number }
  | { type: 'hello'; from: string };

const initial: ShowState = { index: 0, step: 0, blank: false, flags: {}, startedAt: null };

export function useShow(deckId: string, start?: Partial<ShowState>) {
  const id = useRef(Math.random().toString(36).slice(2));
  const [state, setState] = useState<ShowState>({ ...initial, ...start });
  const stateRef = useRef(state);
  stateRef.current = state;
  const channel = useRef<BroadcastChannel | null>(null);
  const [peers, setPeers] = useState(0);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(`lectern:${deckId}`);
    channel.current = ch;
    const seen = new Set<string>();
    ch.onmessage = (e: MessageEvent<Message>) => {
      const msg = e.data;
      if (!msg || msg.from === id.current) return;
      if (!seen.has(msg.from)) { seen.add(msg.from); setPeers(seen.size); }
      if (msg.type === 'hello') ch.postMessage({ type: 'state', from: id.current, state: stateRef.current, at: Date.now() } satisfies Message);
      if (msg.type === 'state') setState(msg.state);
    };
    ch.postMessage({ type: 'hello', from: id.current } satisfies Message);
    return () => { ch.close(); channel.current = null; };
  }, [deckId]);

  const update = useCallback((patch: Partial<ShowState> | ((s: ShowState) => Partial<ShowState>)) => {
    setState((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      channel.current?.postMessage({ type: 'state', from: id.current, state: next, at: Date.now() } satisfies Message);
      return next;
    });
  }, []);

  return { state, update, peers };
}

/** Opens the audience view in a new window and the presenter view here. */
export function openPresenter(deckId: string, navigate: NavigateFunction) {
  const audience = window.open(`/present/${deckId}?audience=1`, `lectern-audience-${deckId}`, 'popup=yes,width=1280,height=720');
  navigate(`/presenter/${deckId}${audience ? '' : '?blocked=1'}`);
}

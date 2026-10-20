// The live link on a phone: joins a shared deck by code, saves it on the phone so
// it keeps working offline, and follows (or, for the presenter, drives) the slides.

import type { DataConnection, Peer } from 'peerjs';
import { useSyncExternalStore } from 'react';
import { registerTheme } from '../../core/engine/themes';
import {
  type GuestMessage, type HostMessage, type JoinMetadata, type LiveState, PartCollector, type PollResult, type Role, type SharePackage,
  type ShareOptions, deviceLabel, isPackage, peerIdFor, receivedAsset,
} from '../../core/share/protocol';
import type { PlayerView, QuizStage, QuizView } from '../../core/share/quiz';
import { db } from '../../data/db';
import { normalizeLook, saveLook } from '../../data/looks';
import { openPeer, peerErrorMessage } from './peer';

export interface LinkSnapshot {
  status: 'idle' | 'connecting' | 'receiving' | 'ready' | 'reconnecting' | 'ended' | 'error';
  error: string | null;
  code: string | null;
  role: Role | null;
  title: string;
  progress: number;
  /** The deck's id on this phone. */
  deckId: string | null;
  options: ShareOptions | null;
  state: LiveState | null;
  votes: Record<string, PollResult>;
  myVotes: Record<string, number>;
  quiz: QuizView | null;
  /** When the quiz update arrived here, for counting down its timer. */
  quizAt: number;
  stage: QuizStage;
  you: PlayerView | null;
  /** This phone's answer to each quiz question. */
  myAnswers: Record<string, number>;
  name: string;
}

/** What the phone remembers about a deck it received. */
export interface SharedRecord {
  key: string;
  value: { deckId: string; title: string; role: Role; code: string; at: number; options: ShareOptions };
}

const idle = (): LinkSnapshot => ({
  status: 'idle', error: null, code: null, role: null, title: '', progress: 0, deckId: null, options: null, state: null, votes: {}, myVotes: {},
  quiz: null, quizAt: 0, stage: 'play', you: null, myAnswers: {}, name: playerName(),
});

const PLAYER_KEY = 'lectern.player';

/** A stable id for this phone, so a dropped connection doesn't lose its score. */
function playerId(): string {
  try {
    const saved = localStorage.getItem(`${PLAYER_KEY}.id`);
    if (saved) return saved;
    const id = Math.random().toString(36).slice(2, 12);
    localStorage.setItem(`${PLAYER_KEY}.id`, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

function playerName(): string {
  try { return localStorage.getItem(`${PLAYER_KEY}.name`) ?? ''; } catch { return ''; }
}

let snap: LinkSnapshot = idle();
const listeners = new Set<() => void>();
function set(patch: Partial<LinkSnapshot>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

let peer: Peer | null = null;
let conn: DataConnection | null = null;
let token: string | undefined;
let collector: PartCollector | null = null;
let mirror: BroadcastChannel | null = null;
let retries = 0;
let retryTimer: number | undefined;
let welcomeTimer: number | undefined;
let stallTimer: number | undefined;
let everReady = false;
const mirrorId = `live-link-${Math.random().toString(36).slice(2)}`;

/**
 * Shared decks get their own ids on the phone, so they never overwrite the phone's own decks.
 * The presenter's copy (with the script) is kept apart from a viewer's copy of the same deck.
 */
export function localDeckId(deckId: string, role: Role = 'audience') {
  const base = deckId.replace(/^shared_(p_)?/, '');
  return role === 'presenter' ? `shared_p_${base}` : `shared_${base}`;
}

/** Which copy a link to this code fetched last. */
function linkKey(code: string, role: Role) {
  return role === 'presenter' ? `link:${code}:p` : `link:${code}`;
}

async function savePackage(pkg: SharePackage, code: string): Promise<string> {
  const deckId = localDeckId(pkg.deck.id, pkg.role);
  await db.assets.bulkPut(pkg.assets.map((a) => receivedAsset(a)));
  if (pkg.theme) {
    const look = normalizeLook(pkg.theme);
    if (look) { registerTheme(look); await saveLook(look).catch(() => {}); }
  }
  await db.decks.put({ ...pkg.deck, id: deckId });
  const record: SharedRecord = { key: `shared:${deckId}`, value: { deckId, title: pkg.deck.title, role: pkg.role, code, at: Date.now(), options: pkg.options } };
  await db.settings.put(record);
  await db.settings.put({ key: linkKey(code, pkg.role), value: { deckId, updatedAt: pkg.deck.updatedAt } });
  return deckId;
}

function openMirror(deckId: string) {
  if (typeof BroadcastChannel === 'undefined' || mirror) return;
  mirror = new BroadcastChannel(`lectern:${deckId}`);
  mirror.onmessage = (e: MessageEvent<{ type: string; from: string; state?: LiveState }>) => {
    const msg = e.data;
    // Ignore other live links (another tab on this device following the same deck).
    if (!msg || msg.from === mirrorId || msg.from?.startsWith('live-link-')) return;
    // The phone's own teleprompter page moved: the presenter's phone drives the show.
    if (msg.type === 'state' && msg.state && snap.role === 'presenter') {
      set({ state: msg.state });
      sendToHost({ t: 'state', state: msg.state });
    } else if (msg.type === 'hello' && snap.state) {
      mirror?.postMessage({ type: 'state', from: mirrorId, state: snap.state, at: Date.now() });
    }
  };
}

function sendToHost(msg: GuestMessage) {
  try { if (conn?.open) void conn.send(msg); } catch { /* reconnecting */ }
}

async function onHostMessage(msg: HostMessage) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome': {
      window.clearTimeout(welcomeTimer);
      set({ role: msg.role, title: msg.title });
      if (msg.same || msg.parts === 0) {
        const known = (await db.settings.get(linkKey(snap.code ?? '', msg.role)))?.value as { deckId?: string } | undefined;
        if (known?.deckId) { ready(known.deckId); return; }
      }
      collector = new PartCollector(msg.parts);
      set({ status: snap.status === 'ready' ? 'ready' : 'receiving', progress: 0 });
      watchStall();
      return;
    }
    case 'part': {
      if (!collector) return;
      const before = Math.floor(collector.progress * 20);
      const done = collector.add(msg.i, msg.data);
      watchStall();
      if (Math.floor(collector.progress * 20) !== before && snap.status === 'receiving') set({ progress: collector.progress });
      if (!done) return;
      const text = collector.text();
      collector = null;
      window.clearTimeout(stallTimer);
      try {
        const pkg: unknown = JSON.parse(text);
        if (!isPackage(pkg)) throw new Error('bad package');
        const deckId = await savePackage(pkg, snap.code ?? '');
        set({ options: pkg.options });
        ready(deckId);
      } catch {
        set({ status: 'error', error: 'The slides didn’t arrive complete. Try joining again.' });
      }
      return;
    }
    case 'state':
      set({ state: msg.state });
      mirror?.postMessage({ type: 'state', from: mirrorId, state: msg.state, at: Date.now() });
      return;
    case 'votes':
      set({ votes: { ...snap.votes, [msg.slideId]: msg.result } });
      return;
    case 'options':
      set({ options: msg.options });
      return;
    case 'quiz':
      set({ quiz: msg.quiz, quizAt: Date.now(), stage: msg.stage });
      return;
    case 'you':
      set({ you: msg.you });
      return;
    case 'bye':
      end();
      return;
  }
}

/** If the slides stop arriving partway, ask for them again. */
function watchStall() {
  window.clearTimeout(stallTimer);
  stallTimer = window.setTimeout(() => {
    if (!collector) return;
    collector = null;
    const c = conn;
    conn = null;
    try { c?.close(); } catch { /* already closed */ }
    scheduleRetry();
  }, 10_000);
}

function ready(deckId: string) {
  everReady = true;
  retries = 0;
  set({ status: 'ready', deckId, progress: 1, error: null });
  openMirror(deckId);
}

function end() {
  window.clearTimeout(retryTimer);
  window.clearTimeout(welcomeTimer);
  window.clearTimeout(stallTimer);
  const p = peer;
  peer = null;
  conn = null;
  p?.destroy();
  set({ status: everReady ? 'ended' : 'error', error: everReady ? null : 'The presenter stopped sharing.' });
}

async function connect() {
  const code = snap.code;
  if (!code) return;
  try {
    if (!peer || peer.destroyed) peer = await openPeer();
    if (snap.code !== code) return;
    peer.removeAllListeners('error');
    peer.on('error', (err) => {
      if ((err as { type?: string }).type === 'peer-unavailable') {
        if (everReady) end();
        else set({ status: 'error', error: peerErrorMessage(err) });
      } else if (everReady) {
        scheduleRetry();
      } else {
        set({ status: 'error', error: peerErrorMessage(err) });
      }
    });
    peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
    const known = (await db.settings.get(linkKey(code, token ? 'presenter' : 'audience')))?.value as { updatedAt?: number } | undefined;
    const metadata: JoinMetadata = { token, have: known?.updatedAt, device: deviceLabel(navigator.userAgent), player: playerId(), name: snap.name || undefined };
    const c = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json', metadata });
    conn = c;
    c.on('data', (raw) => { void onHostMessage(raw as HostMessage); });
    c.on('close', () => { if (conn === c && snap.status !== 'ended' && snap.status !== 'idle') scheduleRetry(); });
    welcomeTimer = window.setTimeout(() => {
      if (conn === c && snap.status === 'connecting') set({ status: 'error', error: 'The presenter’s computer didn’t answer. Make sure it’s still sharing, then try again.' });
    }, 20_000);
  } catch (err) {
    if (everReady) scheduleRetry();
    else set({ status: 'error', error: peerErrorMessage(err) });
  }
}

function scheduleRetry() {
  if (snap.status === 'ended' || snap.status === 'idle') return;
  if (retries >= 12) { end(); return; }
  retries += 1;
  set({ status: everReady ? 'reconnecting' : 'connecting' });
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => { void connect(); }, Math.min(8000, 1500 * retries));
}

export const liveLink = {
  /** Joins a shared deck. Joining the code you're already on does nothing. */
  join(code: string, presenterToken?: string) {
    const active = ['connecting', 'receiving', 'ready', 'reconnecting'].includes(snap.status);
    if (active && snap.code === code && token === presenterToken) return;
    liveLink.leave();
    token = presenterToken;
    everReady = false;
    retries = 0;
    set({ ...idle(), status: 'connecting', code });
    void connect();
  },
  leave() {
    window.clearTimeout(retryTimer);
    window.clearTimeout(welcomeTimer);
    window.clearTimeout(stallTimer);
    try { conn?.close(); } catch { /* closed */ }
    peer?.destroy();
    peer = null;
    conn = null;
    collector = null;
    mirror?.close();
    mirror = null;
    set(idle());
  },
  retry() {
    if (!snap.code) return;
    liveLink.join(snap.code, token);
  },
  /** The presenter's phone moves the slides. */
  setState(state: LiveState) {
    if (snap.role !== 'presenter') return;
    set({ state });
    sendToHost({ t: 'state', state });
    mirror?.postMessage({ type: 'state', from: mirrorId, state, at: Date.now() });
  },
  vote(slideId: string, choice: number) {
    set({ myVotes: { ...snap.myVotes, [slideId]: choice } });
    sendToHost({ t: 'vote', slideId, choice });
  },
  /** A quiz answer: one per question, locked once sent. */
  answer(slideId: string, choice: number) {
    if (snap.myAnswers[slideId] !== undefined) return;
    set({ myAnswers: { ...snap.myAnswers, [slideId]: choice } });
    sendToHost({ t: 'answer', slideId, choice });
  },
  setName(name: string) {
    const clean = name.trim().slice(0, 24);
    try { localStorage.setItem(`${PLAYER_KEY}.name`, clean); } catch { /* private mode */ }
    set({ name: clean });
    if (clean) sendToHost({ t: 'name', name: clean });
  },
  /** The presenter's phone switches the big screen between the quiz and the leaderboard. */
  setStage(stage: QuizStage) {
    if (snap.role !== 'presenter') return;
    set({ stage });
    sendToHost({ t: 'stage', stage });
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  get snapshot() { return snap; },
};

export function useLiveLink(): LinkSnapshot {
  return useSyncExternalStore(liveLink.subscribe, () => snap);
}

/** Decks this phone received, newest first. */
export async function sharedDecks(): Promise<SharedRecord['value'][]> {
  const rows = await db.settings.where('key').startsWith('shared:').toArray();
  const values = rows.map((r) => r.value as SharedRecord['value']);
  const exists = await db.decks.bulkGet(values.map((v) => v.deckId));
  return values.filter((_, i) => exists[i]).sort((a, b) => b.at - a.at);
}

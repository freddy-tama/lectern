// The live link on a phone: joins a shared deck by code, saves it on the phone so
// it keeps working offline, and follows (or, for the presenter, drives) the slides.
//
// Staying connected: a first join tries a few times before it gives up, since the
// connection service and the network often fail once and work the next time. Once
// joined, a link that drops is tried again and again, waiting a little longer each
// time, and right away when the phone comes back on screen or back online. The
// computer pings every few seconds, so a link that died without closing (a phone
// that slept, a network that changed) is noticed and made again.

import type { DataConnection, Peer } from 'peerjs';
import { useSyncExternalStore } from 'react';
import { registerTheme } from '../../core/engine/themes';
import {
  type CloudResult, type GuestMessage, type HostMessage, type JoinMetadata, type LiveState, PartCollector, type PollResult, type Role,
  SILENT_AFTER, type SharePackage, type ShareOptions, cleanWord, deviceLabel, isPackage, peerIdFor, receivedAsset, wordKey,
} from '../../core/share/protocol';
import type { PlayerView, QuizStage, QuizView } from '../../core/share/quiz';
import { db } from '../../data/db';
import { normalizeLook, saveLook } from '../../data/looks';
import { type JoinTrouble, backoff, openPeer, troubleMessage, troubleOf } from './peer';

export interface LinkSnapshot {
  status: 'idle' | 'connecting' | 'receiving' | 'ready' | 'reconnecting' | 'ended' | 'error';
  error: string | null;
  /** Tries that failed in a row, while connecting or reconnecting. */
  attempt: number;
  /** What went wrong on the last failed try. */
  trouble: JoinTrouble | null;
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
  /** Word cloud answers so far, by slide. */
  clouds: Record<string, CloudResult>;
  /** The words this phone sent to each word cloud. */
  myWords: Record<string, string[]>;
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
  status: 'idle', error: null, attempt: 0, trouble: null, code: null, role: null, title: '', progress: 0, deckId: null, options: null, state: null, votes: {}, myVotes: {},
  clouds: {}, myWords: {}, quiz: null, quizAt: 0, stage: 'play', you: null, myAnswers: {}, name: playerName(),
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
let retryTimer: number | undefined;
let attemptTimer: number | undefined;
let stallTimer: number | undefined;
let watchTimer: number | undefined;
let everReady = false;
/** Counts tries, so events from an older try are ignored. */
let run = 0;
/** A try is under way: opening a peer, or waiting for the computer's welcome. */
let trying = false;
/** When the computer last sent anything, and whether it sends pings (older versions don't). */
let lastHeard = 0;
let pinged = false;
/** Since when the computer's code has been missing, after this phone had joined. */
let missingSince: number | null = null;
/** The service said the code was missing on some try of this first join. */
let sawMissing = false;

/** Tries a first join gets before it shows an error. */
const FIRST_TRIES = 4;
/** How long one try waits for the computer's welcome. */
const ATTEMPT_MS = 15_000;
/** A code that stays missing this long after joining means the presenter stopped sharing. */
const MISSING_ENDS = 75_000;
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
      window.clearTimeout(attemptTimer);
      trying = false;
      missingSince = null;
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
    case 'words':
      set({ clouds: { ...snap.clouds, [msg.slideId]: msg.result } });
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
    case 'ping':
      pinged = true;
      sendToHost({ t: 'pong', at: msg.at });
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
    if (collector) failed('silent');
  }, 10_000);
}

function ready(deckId: string) {
  everReady = true;
  set({ status: 'ready', deckId, progress: 1, error: null, attempt: 0, trouble: null });
  openMirror(deckId);
}

function clearTimers() {
  window.clearTimeout(retryTimer);
  window.clearTimeout(attemptTimer);
  window.clearTimeout(stallTimer);
  window.clearInterval(watchTimer);
  retryTimer = attemptTimer = stallTimer = watchTimer = undefined;
}

function end() {
  clearTimers();
  unwatch();
  run++;
  trying = false;
  const p = peer;
  peer = null;
  conn = null;
  p?.destroy();
  set({ status: everReady ? 'ended' : 'error', error: everReady ? null : 'The presenter stopped sharing.' });
}

/** Lets go of the current link, if any, and ignores what it still sends. */
function dropLink() {
  const c = conn;
  conn = null;
  collector = null;
  try { c?.close(); } catch { /* already closed */ }
}

async function connect() {
  const code = snap.code;
  if (!code || trying) return;
  const mine = ++run;
  trying = true;
  window.clearTimeout(attemptTimer);
  dropLink();
  let p: Peer;
  try {
    // A peer that lost the connection service can't make new links: start a fresh one.
    if (!peer || peer.destroyed || peer.disconnected) {
      peer?.destroy();
      peer = null;
      peer = await openPeer(undefined, 12_000);
    }
    p = peer;
  } catch (err) {
    if (mine === run) failed(troubleOf(err));
    return;
  }
  if (mine !== run || snap.code !== code) return;
  p.removeAllListeners('error');
  p.on('error', (err) => {
    if (mine !== run) return;
    const trouble = troubleOf(err);
    // Once joined, losing the service doesn't matter: the link itself goes straight to the computer.
    if (trouble === 'missing' || trying) failed(trouble);
  });
  const known = (await db.settings.get(linkKey(code, token ? 'presenter' : 'audience')))?.value as { updatedAt?: number } | undefined;
  if (mine !== run) return;
  const metadata: JoinMetadata = { token, have: known?.updatedAt, device: deviceLabel(navigator.userAgent), player: playerId(), name: snap.name || undefined };
  const c = p.connect(peerIdFor(code), { reliable: true, serialization: 'json', metadata });
  conn = c;
  let opened = false;
  c.on('open', () => { opened = true; });
  c.on('data', (raw) => {
    if (conn !== c) return;
    lastHeard = Date.now();
    void onHostMessage(raw as HostMessage);
  });
  // A link that never opened was blocked by the network; one that opened and then closed was lost.
  c.on('close', () => { if (conn === c) failed(opened ? 'silent' : 'blocked'); });
  c.on('error', (err) => { if (conn === c && (err as { type?: string }).type !== 'message-too-big') failed(opened ? 'silent' : 'blocked'); });
  attemptTimer = window.setTimeout(() => {
    if (conn === c && trying) failed(opened ? 'silent' : 'blocked');
  }, ATTEMPT_MS);
}

/** A try failed, or a link was lost: try again soon, or give up. */
function failed(trouble: JoinTrouble) {
  if (['idle', 'ended', 'error'].includes(snap.status)) return;
  run++;
  trying = false;
  window.clearTimeout(attemptTimer);
  window.clearTimeout(stallTimer);
  dropLink();
  const attempt = snap.attempt + 1;
  if (!everReady) {
    // The service answers "missing" once per peer and code: the next try needs a fresh peer to hear it again.
    peer?.destroy();
    peer = null;
    if (trouble === 'missing') sawMissing = true;
    // A try that timed out after others heard "missing" was most likely missing too.
    if (trouble === 'blocked' && sawMissing) trouble = 'missing';
    if (attempt >= FIRST_TRIES) {
      clearTimers();
      unwatch();
      set({ status: 'error', error: troubleMessage(trouble), trouble, attempt });
      return;
    }
  }
  if (everReady && trouble === 'missing') {
    // The computer left the service: it stopped sharing without a goodbye, or it is reconnecting.
    missingSince ??= Date.now();
    if (Date.now() - missingSince > MISSING_ENDS) { end(); return; }
  }
  set({ status: everReady ? 'reconnecting' : 'connecting', attempt, trouble });
  scheduleRetry();
}

function scheduleRetry(now = false) {
  window.clearTimeout(retryTimer);
  retryTimer = undefined;
  // A phone in a pocket waits, and tries again as soon as it's back on screen.
  if (!now && document.visibilityState === 'hidden') return;
  const wait = now ? 0 : backoff(snap.attempt, 800, everReady ? 10_000 : 3000);
  retryTimer = window.setTimeout(() => { retryTimer = undefined; void connect(); }, wait);
}

/** Back on screen or back online: check the link, and don't wait for the next try. */
function wake() {
  if (document.visibilityState === 'hidden') return;
  if (snap.status === 'connecting' || snap.status === 'reconnecting') {
    if (!trying) scheduleRetry(true);
  } else if (snap.status === 'ready' && (!conn?.open || (pinged && Date.now() - lastHeard > SILENT_AFTER))) {
    failed('silent');
  }
}

/** While the phone is on screen, a link that went quiet is made again. */
function check() {
  if (document.visibilityState === 'hidden' || snap.status !== 'ready') return;
  if (!conn || (pinged && Date.now() - lastHeard > SILENT_AFTER)) failed('silent');
}

const onVisibility = () => wake();

function watch() {
  window.clearInterval(watchTimer);
  watchTimer = window.setInterval(check, 3000);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
}

function unwatch() {
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('online', wake);
  window.removeEventListener('pageshow', wake);
}

export const liveLink = {
  /** Joins a shared deck. Joining the code you're already on does nothing. */
  join(code: string, presenterToken?: string) {
    const active = ['connecting', 'receiving', 'ready', 'reconnecting'].includes(snap.status);
    if (active && snap.code === code && token === presenterToken) return;
    liveLink.leave();
    token = presenterToken;
    everReady = false;
    pinged = false;
    lastHeard = 0;
    missingSince = null;
    sawMissing = false;
    set({ ...idle(), status: 'connecting', code });
    watch();
    void connect();
  },
  leave() {
    clearTimers();
    unwatch();
    run++;
    trying = false;
    dropLink();
    peer?.destroy();
    peer = null;
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
  /** An answer to a word cloud. False when it is empty, a repeat, or over the slide's limit. */
  sendWord(slideId: string, raw: string, limit: number): boolean {
    const text = cleanWord(raw);
    const mine = snap.myWords[slideId] ?? [];
    if (!text || mine.length >= limit || mine.some((w) => wordKey(w) === wordKey(text))) return false;
    set({ myWords: { ...snap.myWords, [slideId]: [...mine, text] } });
    sendToHost({ t: 'word', slideId, text });
    return true;
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

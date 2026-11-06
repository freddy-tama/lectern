// The live link on a phone: joins a shared deck by code, saves it on the phone so
// it keeps working offline, and follows (or, for the presenter, drives) the slides.
//
// Staying connected: a first join tries a few times before it says what's wrong, since the
// connection service and the network often fail once and work the next time, and it goes on
// trying slowly after that. Once joined, a link that drops is tried again and again, waiting
// a little longer each time, and right away when the phone comes back on screen or back
// online. The computer pings every few seconds, so a link that died without closing (a phone
// that slept, a network that changed) is noticed and made again. Only the presenter stopping
// ends it: a computer that went quiet may be back in a moment.
//
// Keeping what people did: an answer, vote or word is saved on the phone as it is tapped, and
// stays in an outbox until the computer confirms it, so a dropped link or a reload loses
// nothing. The computer's 'mine' message is the truth about what counted.
//
// One phone, one link: when the same phone opens the deck twice, the computer tells the older
// copy it was replaced. That copy stops trying, or the two would push each other off for ever.

import type { DataConnection, Peer } from 'peerjs';
import { useSyncExternalStore } from 'react';
import { registerTheme } from '../../core/engine/themes';
import {
  type CloudResult, type GuestMessage, type HostMessage, type JoinMetadata, type LiveState, type MineView, PartCollector, type PollResult, type Role,
  SILENT_AFTER, type SharePackage, type ShareOptions, WEAK_AFTER, cleanWord, deviceLabel, isPackage, peerIdFor, receivedAsset, wordKey,
} from '../../core/share/protocol';
import type { PlayerView, QuizStage, QuizView } from '../../core/share/quiz';
import { db } from '../../data/db';
import { normalizeLook, saveLook } from '../../data/looks';
import { type JoinTrouble, backoff, openPeer, troubleMessage, troubleOf } from './peer';

/** Something this phone sent that the computer hasn't confirmed yet. `at` is when it was tapped. */
export type OutboxItem =
  | { t: 'answer'; slideId: string; choice: number; at: number }
  | { t: 'vote'; slideId: string; choice: number; at: number }
  | { t: 'word'; slideId: string; text: string; at: number };

export interface LinkSnapshot {
  status: 'idle' | 'connecting' | 'receiving' | 'ready' | 'reconnecting' | 'ended' | 'replaced' | 'error';
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
  /** What the computer hasn't confirmed yet. */
  outbox: OutboxItem[];
  /** Questions whose answer got to the computer too late to count. */
  late: Record<string, true>;
  /** The link is up, but the computer has been quiet for a while. */
  weak: boolean;
  name: string;
}

/** What the phone remembers about a deck it received. */
export interface SharedRecord {
  key: string;
  value: { deckId: string; title: string; role: Role; code: string; at: number; options: ShareOptions };
}

const idle = (): LinkSnapshot => ({
  status: 'idle', error: null, attempt: 0, trouble: null, code: null, role: null, title: '', progress: 0, deckId: null, options: null, state: null, votes: {}, myVotes: {},
  clouds: {}, myWords: {}, quiz: null, quizAt: 0, stage: 'play', you: null, myAnswers: {}, outbox: [], late: {}, weak: false, name: playerName(),
});

const PLAYER_KEY = 'lectern.player';

let myPlayerId: string | null = null;

function storedPlayerId(store: () => Storage): string | null {
  try {
    const s = store();
    const saved = s.getItem(`${PLAYER_KEY}.id`);
    if (saved) return saved;
    const id = Math.random().toString(36).slice(2, 12);
    s.setItem(`${PLAYER_KEY}.id`, id);
    return id;
  } catch {
    return null;
  }
}

/** A stable id for this phone, so a dropped connection or a reload doesn't lose its score. */
function playerId(): string {
  myPlayerId ??= storedPlayerId(() => localStorage) ?? storedPlayerId(() => sessionStorage) ?? Math.random().toString(36).slice(2, 12);
  return myPlayerId;
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

// ─── What this phone keeps for a code ─────────────────────────────────

const LINK_KEY = 'lectern.link.';
/** How long a phone keeps its answers to a code it left. */
const LINK_KEEP = 24 * 60 * 60_000;

type Kept = Pick<LinkSnapshot, 'myAnswers' | 'myVotes' | 'myWords' | 'outbox' | 'late'>;

function remember() {
  if (!snap.code) return;
  const { myAnswers, myVotes, myWords, outbox, late } = snap;
  try { localStorage.setItem(LINK_KEY + snap.code, JSON.stringify({ myAnswers, myVotes, myWords, outbox, late, at: Date.now() })); } catch { /* private mode */ }
}

function recall(code: string): Partial<Kept> {
  try {
    const kept = JSON.parse(localStorage.getItem(LINK_KEY + code) ?? 'null') as Partial<Kept> | null;
    if (!kept || typeof kept !== 'object') return {};
    return {
      myAnswers: kept.myAnswers ?? {}, myVotes: kept.myVotes ?? {}, myWords: kept.myWords ?? {},
      outbox: Array.isArray(kept.outbox) ? kept.outbox : [], late: kept.late ?? {},
    };
  } catch {
    return {};
  }
}

function forgetOldLinks(now = Date.now()) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LINK_KEY)) continue;
      const at = (JSON.parse(localStorage.getItem(key) ?? 'null') as { at?: number } | null)?.at ?? 0;
      if (now - at > LINK_KEEP) localStorage.removeItem(key);
    }
  } catch { /* private mode */ }
}

const sameItem = (a: OutboxItem, b: OutboxItem) => a.t === b.t && a.slideId === b.slideId && (a.t !== 'word' || wordKey(a.text) === wordKey((b as typeof a).text));

let peer: Peer | null = null;
let conn: DataConnection | null = null;
let token: string | undefined;
let collector: PartCollector | null = null;
let mirror: BroadcastChannel | null = null;
let retryTimer: number | undefined;
let triedAt = 0;
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
/** The service said the code was missing on some try of this first join. */
let sawMissing = false;
/** This computer confirms what it receives (older versions don't). */
let hostAcks = false;
/** When the outbox last went out. */
let flushedAt = 0;

/** Tries a first join gets before it shows an error. It goes on trying more slowly after that. */
const FIRST_TRIES = 4;
/** How long one try waits for the computer's welcome. A link through a relay can take a while to find. */
const ATTEMPT_MS = 20_000;
/** How often what the computer hasn't confirmed goes out again, on a link that looks fine. */
const RESEND_EVERY = 4000;
/** Votes and words the computer never confirms are let go after this: it isn't taking them. */
const OUTBOX_KEEP = 120_000;
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

function sendItem(item: OutboxItem) {
  if (item.t === 'answer') sendToHost({ t: 'answer', slideId: item.slideId, choice: item.choice, ago: Math.max(0, Date.now() - item.at) });
  else if (item.t === 'vote') sendToHost({ t: 'vote', slideId: item.slideId, choice: item.choice });
  else sendToHost({ t: 'word', slideId: item.slideId, text: item.text });
}

/** Sends everything the computer hasn't confirmed. It takes each thing once, so sending again is safe. */
function flushOutbox() {
  if (snap.status !== 'ready' || !conn?.open || !snap.outbox.length) return;
  flushedAt = Date.now();
  snap.outbox.forEach(sendItem);
  // A computer on an older version sends no confirmations: what went out is as safe as it gets.
  if (!hostAcks) { set({ outbox: [] }); remember(); }
}

/** Keeps something new until the computer confirms it, and sends it if the link is up. */
function hold(item: OutboxItem, patch: Partial<LinkSnapshot>) {
  set({ ...patch, outbox: [...snap.outbox.filter((o) => !sameItem(o, item)), item] });
  remember();
  if (snap.status === 'ready' && conn?.open) {
    sendItem(item);
    if (!hostAcks) { set({ outbox: snap.outbox.filter((o) => o !== item) }); remember(); }
  }
}

/** The computer says what it has from this phone. Whatever is still on its way stays on top of that. */
function onMine(mine: MineView) {
  const refused = new Set(mine.refused ?? []);
  const outbox = snap.outbox.filter((o) => {
    if (o.t === 'answer') return mine.answers[o.slideId] === undefined && !refused.has(o.slideId);
    if (o.t === 'vote') return mine.votes[o.slideId] !== o.choice;
    return !(mine.words[o.slideId] ?? []).some((w) => wordKey(w) === wordKey(o.text));
  });
  const myAnswers = { ...mine.answers };
  const myVotes = { ...mine.votes };
  const myWords = { ...mine.words };
  for (const o of outbox) {
    if (o.t === 'answer') myAnswers[o.slideId] = o.choice;
    else if (o.t === 'vote') myVotes[o.slideId] = o.choice;
    else myWords[o.slideId] = [...(myWords[o.slideId] ?? []), o.text];
  }
  const late = { ...snap.late };
  for (const id of refused) late[id] = true;
  // An answer that counted after all, or a quiz that started over.
  for (const id of Object.keys(late)) if (!refused.has(id) && mine.answers[id] !== undefined) delete late[id];
  set({ myAnswers, myVotes, myWords, outbox, late });
  remember();
}

async function onHostMessage(msg: HostMessage) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome': {
      window.clearTimeout(attemptTimer);
      trying = false;
      hostAcks = msg.acks === true;
      set({ role: msg.role, title: msg.title });
      if (msg.same || msg.parts === 0) {
        const known = (await db.settings.get(linkKey(snap.code ?? '', msg.role)))?.value as { deckId?: string } | undefined;
        if (known?.deckId) { ready(known.deckId); return; }
      }
      collector = new PartCollector(msg.parts);
      // A phone that already shows the slides keeps showing them while a new copy arrives.
      set({ status: snap.status === 'ready' ? 'ready' : everReady ? 'reconnecting' : 'receiving', progress: 0, error: null });
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
        if (everReady) failed('silent');
        else set({ status: 'error', error: 'The slides didn’t arrive complete. Try joining again.' });
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
    case 'mine':
      onMine(msg);
      return;
    case 'replaced':
      replaced();
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
  sawMissing = false;
  set({ status: 'ready', deckId, progress: 1, error: null, attempt: 0, trouble: null, weak: false });
  openMirror(deckId);
  flushOutbox();
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
  set({ status: everReady ? 'ended' : 'error', error: everReady ? null : 'The presenter stopped sharing.', weak: false });
}

/** This phone opened the deck again somewhere else: this copy stands down until asked. */
function replaced() {
  clearTimers();
  unwatch();
  run++;
  trying = false;
  const p = peer;
  peer = null;
  dropLink();
  p?.destroy();
  set({ status: 'replaced', weak: false });
}

/** The saved copy a link to this code fetched, if it is still on this phone. */
async function knownDeck(code: string, role: Role): Promise<{ deckId: string; updatedAt?: number } | null> {
  const value = (await db.settings.get(linkKey(code, role)))?.value as { deckId?: string; updatedAt?: number } | undefined;
  if (!value?.deckId || !(await db.decks.get(value.deckId))) return null;
  return { deckId: value.deckId, updatedAt: value.updatedAt };
}

/** A phone that already has this deck shows it straight away, after a reload too, while the link is made. */
async function pickUpSaved(code: string) {
  const role: Role = token ? 'presenter' : 'audience';
  const known = await knownDeck(code, role);
  const record = known ? (await db.settings.get(`shared:${known.deckId}`))?.value as SharedRecord['value'] | undefined : undefined;
  if (!known || snap.code !== code || snap.status !== 'connecting') return;
  everReady = true;
  set({ status: 'reconnecting', role, deckId: known.deckId, title: record?.title ?? '', options: record?.options ?? null });
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
  triedAt = Date.now();
  window.clearTimeout(attemptTimer);
  dropLink();
  let p: Peer;
  try {
    // A peer that lost the connection service can't make new links: start a fresh one.
    if (!peer || peer.destroyed || peer.disconnected) {
      peer?.destroy();
      peer = null;
      // A connection that hangs is usually better off starting again, soon. A slow network gets longer.
      const opened = await openPeer(undefined, snap.attempt < 2 ? 6000 : 12_000);
      if (mine !== run) { opened.destroy(); return; }
      peer = opened;
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
  const known = await knownDeck(code, token ? 'presenter' : 'audience');
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

/** A try failed, or a link was lost: try again soon. */
function failed(trouble: JoinTrouble) {
  if (['idle', 'ended', 'replaced'].includes(snap.status)) return;
  run++;
  trying = false;
  window.clearTimeout(attemptTimer);
  window.clearTimeout(stallTimer);
  dropLink();
  const attempt = snap.attempt + 1;
  if (trouble === 'missing') sawMissing = true;
  // A try that timed out after others heard "missing" was most likely missing too.
  if (trouble === 'blocked' && sawMissing) trouble = 'missing';
  // The service answers "missing" once per peer and code. A second offer from that peer hears
  // nothing at all, and would sit out a whole try: the next try needs a fresh peer.
  if (!everReady || trouble === 'missing') {
    peer?.destroy();
    peer = null;
  }
  if (!everReady && attempt >= FIRST_TRIES) {
    // Say what's wrong, and keep trying: the presenter may only now be starting, or the network coming back.
    set({ status: 'error', error: troubleMessage(trouble), trouble, attempt });
    scheduleRetry();
    return;
  }
  set({ status: everReady ? 'reconnecting' : 'connecting', attempt, trouble, weak: false });
  scheduleRetry();
}

function scheduleRetry(now = false) {
  window.clearTimeout(retryTimer);
  retryTimer = undefined;
  // A phone in a pocket waits, and tries again as soon as it's back on screen.
  if (!now && document.visibilityState === 'hidden') return;
  const cap = everReady ? (snap.attempt > 20 ? 30_000 : 10_000) : snap.status === 'error' ? 15_000 : 3000;
  const wait = now ? 0 : backoff(snap.attempt, 800, cap);
  retryTimer = window.setTimeout(() => { retryTimer = undefined; void connect(); }, wait);
}

/** Whether this computer sends pings, so that silence means something. Older copies of the app don't. */
function expectsPings() {
  return pinged || hostAcks;
}

function stillTrying() {
  return snap.status === 'connecting' || snap.status === 'reconnecting' || snap.status === 'error';
}

/** Back on screen or back online: check the link, and don't wait for the next try. */
function wake() {
  if (document.visibilityState === 'hidden') return;
  if (stillTrying()) {
    // Slides on their way aren't interrupted.
    if (collector) return;
    if (!trying) scheduleRetry(true);
    // A try from before the phone slept may never finish.
    else if (Date.now() - triedAt > 5000) liveLink.tryNow();
  } else if (snap.status === 'ready' && (!conn?.open || (expectsPings() && Date.now() - lastHeard > SILENT_AFTER))) {
    failed('silent');
  }
}

/** Back on a network, the old connection to the service is usually dead, even if it doesn't say so yet. */
function onOnline() {
  if (stillTrying() && !collector) liveLink.tryNow();
  else wake();
}

/** While the phone is on screen: says when the link goes quiet, makes it again if it stays quiet, and resends what wasn't confirmed. */
function check() {
  if (document.visibilityState === 'hidden' || snap.status !== 'ready') return;
  const now = Date.now();
  const quiet = now - lastHeard;
  if (!conn || (expectsPings() && quiet > SILENT_AFTER)) { failed('silent'); return; }
  const weak = expectsPings() && quiet > WEAK_AFTER;
  if (weak !== snap.weak) set({ weak });
  if (!snap.outbox.length) return;
  const kept = snap.outbox.filter((o) => o.t === 'answer' || now - o.at < OUTBOX_KEEP);
  if (kept.length !== snap.outbox.length) { set({ outbox: kept }); remember(); }
  if (now - flushedAt > RESEND_EVERY) flushOutbox();
}

const onVisibility = () => wake();

function watch() {
  window.clearInterval(watchTimer);
  watchTimer = window.setInterval(check, 3000);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('pageshow', wake);
  document.addEventListener('resume', wake);
}

function unwatch() {
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('online', onOnline);
  window.removeEventListener('pageshow', wake);
  document.removeEventListener('resume', wake);
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
    sawMissing = false;
    hostAcks = false;
    flushedAt = 0;
    forgetOldLinks();
    set({ ...idle(), status: 'connecting', code, ...recall(code) });
    watch();
    void pickUpSaved(code);
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
  /** "Try now": a fresh try straight away, without waiting for the next one. */
  tryNow() {
    if (!snap.code) return;
    if (snap.status === 'ended' || snap.status === 'replaced') { liveLink.retry(); return; }
    window.clearTimeout(retryTimer);
    window.clearTimeout(attemptTimer);
    window.clearTimeout(stallTimer);
    retryTimer = undefined;
    run++;
    trying = false;
    dropLink();
    peer?.destroy();
    peer = null;
    set({ attempt: 0, trouble: null });
    void connect();
  },
  /** The presenter's phone moves the slides. */
  setState(state: LiveState) {
    if (snap.role !== 'presenter') return;
    set({ state });
    sendToHost({ t: 'state', state });
    mirror?.postMessage({ type: 'state', from: mirrorId, state, at: Date.now() });
  },
  vote(slideId: string, choice: number) {
    hold({ t: 'vote', slideId, choice, at: Date.now() }, { myVotes: { ...snap.myVotes, [slideId]: choice } });
  },
  /** An answer to a word cloud. False when it is empty, a repeat, or over the slide's limit. */
  sendWord(slideId: string, raw: string, limit: number): boolean {
    const text = cleanWord(raw);
    const mine = snap.myWords[slideId] ?? [];
    if (!text || mine.length >= limit || mine.some((w) => wordKey(w) === wordKey(text))) return false;
    hold({ t: 'word', slideId, text, at: Date.now() }, { myWords: { ...snap.myWords, [slideId]: [...mine, text] } });
    return true;
  },
  /** A quiz answer: one per question, locked once tapped, and kept until the computer has it. */
  answer(slideId: string, choice: number) {
    if (snap.myAnswers[slideId] !== undefined) return;
    hold({ t: 'answer', slideId, choice, at: Date.now() }, { myAnswers: { ...snap.myAnswers, [slideId]: choice } });
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

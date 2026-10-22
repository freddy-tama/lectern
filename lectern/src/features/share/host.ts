// The sharing session on the presenter's computer. It lives outside React so it
// keeps running while you move between the studio, presenter view and slides.
//
// It joins the same BroadcastChannel the presenter windows use (see present/sync.ts):
// slide changes made on the computer go out to phones, and the presenter's phone
// can move the slides on the computer.

import { liveQuery } from 'dexie';
import type { DataConnection, Peer } from 'peerjs';
import { useSyncExternalStore } from 'react';
import type { Deck } from '../../core/deck/types';
import { getTheme, isBuiltInTheme } from '../../core/engine/themes';
import {
  type CloudResult, DEFAULT_OPTIONS, type GuestMessage, type HostMessage, type JoinMetadata, type LiveState, type PollResult, type Role,
  type SharePackage, type ShareOptions, assetIds, cleanWord, cloudLimit, deckForRole, joinUrl, newCode, newToken, peerIdFor, pollChoices,
  sharedAsset, splitParts, tally, tallyWords, wordKey,
} from '../../core/share/protocol';
import {
  type BoardRow, DEFAULT_QUIZ, QuizEngine, type QuizResults, type QuizSettings, type QuizStage, type QuizView,
} from '../../core/share/quiz';
import { db } from '../../data/db';
import { saveDeck } from '../../data/repo';
import { openPeer, peerErrorMessage } from './peer';

export interface GuestInfo {
  id: string;
  role: Role;
  device: string;
  ready: boolean;
  since: number;
}

export interface HostSnapshot {
  status: 'idle' | 'starting' | 'live' | 'error';
  error: string | null;
  deckId: string | null;
  title: string;
  code: string | null;
  token: string | null;
  options: ShareOptions;
  guests: GuestInfo[];
  state: LiveState | null;
  votes: Record<string, PollResult>;
  /** Word cloud answers so far, by slide. */
  clouds: Record<string, CloudResult>;
  onScreen: boolean;
  panel: { open: boolean; deckId: string | null };
  quizSettings: QuizSettings;
  /** The presenter's view of the quiz: live counts, top ten. */
  quiz: QuizView | null;
  /** Every player, ranked. */
  quizBoard: BoardRow[];
  stage: QuizStage;
}

/** The quiz as the big screen shows it. */
export interface ScreenQuiz {
  view: QuizView;
  stage: QuizStage;
}

/** Messages between the sharing session and audience windows showing the join code. */
export type ScreenMessage =
  | { type: 'screen'; show: boolean; code: string | null; url: string | null; quiz?: ScreenQuiz | null; clouds?: Record<string, CloudResult> }
  | { type: 'ask' };

const OPTIONS_KEY = 'lectern.share';
const QUIZ_KEY = 'lectern.quiz';

function loadQuizSettings(): QuizSettings {
  try { return { ...DEFAULT_QUIZ, ...JSON.parse(localStorage.getItem(QUIZ_KEY) ?? '{}') }; } catch { return { ...DEFAULT_QUIZ }; }
}

function loadOptions(): ShareOptions {
  try { return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') }; } catch { return { ...DEFAULT_OPTIONS }; }
}

const idle = (): HostSnapshot => ({
  status: 'idle', error: null, deckId: null, title: '', code: null, token: null, options: loadOptions(),
  guests: [], state: null, votes: {}, clouds: {}, onScreen: false, panel: { open: false, deckId: null },
  quizSettings: loadQuizSettings(), quiz: null, quizBoard: [], stage: 'play',
});

let snap: HostSnapshot = idle();
const listeners = new Set<() => void>();

function set(patch: Partial<HostSnapshot>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

// Session resources, alive while sharing.
let peer: Peer | null = null;
let channel: BroadcastChannel | null = null;
let screen: BroadcastChannel | null = null;
let deckWatch: { unsubscribe(): void } | null = null;
let deck: Deck | null = null;
let resendTimer: number | undefined;
const conns = new Map<string, { conn: DataConnection; role: Role; player: string }>();
let quiz = new QuizEngine(loadQuizSettings());
let quizTimer: number | undefined;
let publishTimer: number | undefined;
const votes = new Map<string, Map<string, number>>();
/** Word cloud answers: slide → phone → the words it sent. */
const words = new Map<string, Map<string, string[]>>();
/** Words the presenter took off a cloud, by slide, as word keys. */
const hiddenWords = new Map<string, Set<string>>();
let cloudTimer: number | undefined;
const cloudsDue = new Set<string>();
const packages = new Map<string, string>();
const bridgeId = `live-host-${Math.random().toString(36).slice(2)}`;

function guestsChanged(id: string, patch: Partial<GuestInfo> | null) {
  const others = snap.guests.filter((g) => g.id !== id);
  if (!patch) { set({ guests: others }); return; }
  const prev = snap.guests.find((g) => g.id === id);
  const next: GuestInfo = { id, role: 'audience', device: 'Device', ready: false, since: Date.now(), ...prev, ...patch };
  set({ guests: [...others, next].sort((a, b) => a.since - b.since) });
}

function send(conn: DataConnection, msg: HostMessage) {
  try { if (conn.open) void conn.send(msg); } catch { /* the connection closed meanwhile */ }
}

function broadcast(msg: HostMessage, except?: string, role?: Role) {
  for (const [id, c] of conns) {
    if (id === except || (role && c.role !== role)) continue;
    if (snap.guests.find((g) => g.id === id)?.ready) send(c.conn, msg);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Largest video file sent to phones. */
const PHONE_VIDEO_MAX = 8 * 1024 * 1024;

async function packageFor(role: Role): Promise<string | null> {
  if (!deck) return null;
  const key = `${role}:${deck.updatedAt}:${JSON.stringify(snap.options)}`;
  const hit = packages.get(key);
  if (hit) return hit;
  const shared = deckForRole(deck, role, snap.options);
  const theme = getTheme(deck.themeId);
  const custom = isBuiltInTheme(theme.id) ? undefined : theme;
  const assets: SharePackage['assets'] = [];
  for (const id of assetIds({ shared, custom })) {
    const asset = await db.assets.get(id);
    // Big video files stay on the main screen; phones show a still in their place.
    if (asset && !(asset.mime.startsWith('video/') && asset.blob.size > PHONE_VIDEO_MAX)) assets.push(sharedAsset(asset, await blobToDataUrl(asset.blob)));
  }
  const pkg: SharePackage = { format: 'lectern-share', version: 1, role, deck: shared, theme: custom, assets, options: snap.options };
  const json = JSON.stringify(pkg);
  packages.set(key, json);
  return json;
}

const LOW_WATER = 256 * 1024;

/**
 * Waits while a connection still has a lot queued. Listens for the channel's own
 * event rather than polling: timers in a background tab can be slowed to once a minute.
 */
function drained(conn: DataConnection): Promise<void> {
  const channel = (conn as unknown as { dataChannel?: RTCDataChannel }).dataChannel;
  if (!channel || !conn.open || channel.bufferedAmount <= LOW_WATER) return Promise.resolve();
  return new Promise((resolve) => {
    channel.bufferedAmountLowThreshold = LOW_WATER;
    const done = () => {
      channel.removeEventListener('bufferedamountlow', done);
      channel.removeEventListener('close', done);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', done);
    channel.addEventListener('close', done);
  });
}

async function deliver(conn: DataConnection, role: Role, have?: number) {
  if (!deck) return;
  if (have && have === deck.updatedAt) {
    send(conn, { t: 'welcome', role, title: deck.title, parts: 0, bytes: 0, same: true });
  } else {
    const json = await packageFor(role);
    if (!json) return;
    const parts = splitParts(json);
    send(conn, { t: 'welcome', role, title: deck.title, parts: parts.length, bytes: json.length });
    for (let i = 0; i < parts.length; i++) {
      // Queue only what the connection can carry: a room of phones joining at once
      // would otherwise stall it.
      if (i % 8 === 0) await drained(conn);
      if (!conn.open) return;
      send(conn, { t: 'part', i, data: parts[i]! });
    }
  }
  // The phone left while its slides were on the way.
  if (conns.get(conn.peer)?.conn !== conn) return;
  guestsChanged(conn.peer, { ready: true });
  if (snap.state) send(conn, { t: 'state', state: snap.state });
  for (const [slideId, result] of Object.entries(snap.votes)) send(conn, { t: 'votes', slideId, result });
  for (const [slideId, result] of Object.entries(snap.clouds)) send(conn, { t: 'words', slideId, result });
  const c = conns.get(conn.peer);
  if (c) {
    send(conn, { t: 'quiz', quiz: quiz.view(role, Date.now(), role === 'presenter' ? 10 : 5), stage: snap.stage });
    if (role === 'audience') send(conn, { t: 'you', you: quiz.playerView(c.player) });
  }
}

// --- Word clouds --------------------------------------------------------

/** Counts a cloud again and sends it to every phone and the big screen. */
function publishCloud(slideId: string) {
  const result = tallyWords(words.get(slideId) ?? new Map(), hiddenWords.get(slideId));
  set({ clouds: { ...snap.clouds, [slideId]: result } });
  broadcast({ t: 'words', slideId, result });
  postScreen();
}

/** Words arrive in bursts as a room types: redraw the cloud a few times a second at most. */
function publishCloudSoon(slideId: string) {
  cloudsDue.add(slideId);
  if (cloudTimer !== undefined) return;
  cloudTimer = window.setTimeout(() => {
    cloudTimer = undefined;
    const due = [...cloudsDue];
    cloudsDue.clear();
    due.forEach(publishCloud);
  }, 300);
}

/** Takes one answer from a phone. Each phone sends up to the slide's limit, and the same word once. */
function addWord(device: string, slideId: string, raw: string): boolean {
  const limit = cloudLimit(visibleSlides().find((s) => s.id === slideId));
  const text = cleanWord(raw);
  if (!limit || !text) return false;
  const slideWords = words.get(slideId) ?? new Map<string, string[]>();
  const mine = slideWords.get(device) ?? [];
  if (mine.length >= limit || mine.some((w) => wordKey(w) === wordKey(text))) return false;
  slideWords.set(device, [...mine, text]);
  words.set(slideId, slideWords);
  return true;
}

// --- Quiz ---------------------------------------------------------------

/** Sends the quiz to every phone, the share window and the big screen. */
function publishQuiz() {
  window.clearTimeout(publishTimer);
  publishTimer = undefined;
  const now = Date.now();
  const presenter = quiz.view('presenter', now, 10);
  const audience = quiz.view('audience', now, 5);
  set({ quiz: presenter, quizBoard: quiz.board() });
  for (const [, c] of conns) {
    if (!snap.guests.find((g) => g.id === c.conn.peer)?.ready) continue;
    send(c.conn, { t: 'quiz', quiz: c.role === 'presenter' ? presenter : audience, stage: snap.stage });
    if (c.role === 'audience') send(c.conn, { t: 'you', you: quiz.playerView(c.player) });
  }
  postScreen();
  // Wake up when the timer runs out.
  window.clearTimeout(quizTimer);
  const deadline = quiz.nextDeadline();
  if (deadline !== null) quizTimer = window.setTimeout(() => { if (quiz.tick(Date.now())) publishQuiz(); }, Math.max(0, deadline - now));
}

/** Answers arrive in bursts: send at most a few updates a second. */
function publishSoon() {
  if (publishTimer === undefined) publishTimer = window.setTimeout(publishQuiz, 250);
}

/** Opens, locks and reveals questions as the slides move. */
function followShow(state: LiveState) {
  const slide = visibleSlides()[state.index];
  if (quiz.follow(slide, state.step, Date.now())) {
    // A new question brings everyone back from the leaderboard.
    if (snap.stage !== 'play' && slide && quiz.isQuizSlide(slide.id) && state.step === 0) set({ stage: 'play' });
    publishQuiz();
  }
}

function onConnection(conn: DataConnection) {
  conn.on('open', () => {
    const meta = (conn.metadata ?? {}) as Partial<JoinMetadata>;
    const role: Role = meta.token && meta.token === snap.token ? 'presenter' : 'audience';
    const player = typeof meta.player === 'string' && meta.player ? meta.player.slice(0, 40) : conn.peer;
    conns.set(conn.peer, { conn, role, player });
    if (role === 'audience') { quiz.join(player, typeof meta.name === 'string' ? meta.name : undefined); publishSoon(); }
    guestsChanged(conn.peer, { role, device: typeof meta.device === 'string' ? meta.device.slice(0, 40) : 'Device', ready: false, since: Date.now() });
    void deliver(conn, role, typeof meta.have === 'number' ? meta.have : undefined);
  });
  conn.on('data', (raw) => onGuestMessage(conn, raw as GuestMessage));
  const drop = () => {
    if (conns.get(conn.peer)?.conn !== conn) return;
    conns.delete(conn.peer);
    guestsChanged(conn.peer, null);
  };
  conn.on('close', drop);
  // One message that was too big to send doesn't mean the phone is gone.
  conn.on('error', (err) => { if ((err as { type?: string }).type !== 'message-too-big') drop(); });
}

function visibleSlides() {
  return deck?.slides.filter((s) => !s.hidden) ?? [];
}

function onGuestMessage(conn: DataConnection, msg: GuestMessage) {
  const guest = conns.get(conn.peer);
  const role = guest?.role;
  if (!guest || !role || !msg || typeof msg !== 'object') return;
  if (msg.t === 'state' && role === 'presenter') {
    set({ state: msg.state });
    channel?.postMessage({ type: 'state', from: bridgeId, state: msg.state, at: Date.now() });
    broadcast({ t: 'state', state: msg.state }, conn.peer);
    followShow(msg.state);
  } else if (msg.t === 'answer') {
    if (role === 'audience' && quiz.answer(guest.player, msg.slideId, msg.choice, Date.now())) publishSoon();
  } else if (msg.t === 'name') {
    if (role === 'audience' && typeof msg.name === 'string') { quiz.join(guest.player, msg.name); publishSoon(); }
  } else if (msg.t === 'stage') {
    if (role === 'presenter' && ['play', 'leaderboard', 'podium'].includes(msg.stage)) { set({ stage: msg.stage }); publishQuiz(); }
  } else if (msg.t === 'word') {
    if (role === 'audience' && !snap.options.polls) return;
    if (typeof msg.slideId === 'string' && typeof msg.text === 'string' && addWord(guest.player, msg.slideId, msg.text)) publishCloudSoon(msg.slideId);
  } else if (msg.t === 'vote') {
    if (role === 'audience' && !snap.options.polls) return;
    const slide = visibleSlides().find((s) => s.id === msg.slideId);
    const choices = pollChoices(slide);
    if (!choices || !Number.isInteger(msg.choice) || msg.choice < 0 || msg.choice >= choices.length) return;
    const slideVotes = votes.get(msg.slideId) ?? new Map<string, number>();
    slideVotes.set(conn.peer, msg.choice);
    votes.set(msg.slideId, slideVotes);
    const result = tally(slideVotes, choices.length);
    set({ votes: { ...snap.votes, [msg.slideId]: result } });
    broadcast({ t: 'votes', slideId: msg.slideId, result });
  }
}

function postScreen() {
  const url = snap.code ? joinUrl(window.location.origin, snap.code) : null;
  const live = snap.status === 'live';
  const view = live && quiz.settings.on ? quiz.view('audience', Date.now(), 5) : null;
  const showQuiz = !!view && (!!view.question || snap.stage !== 'play');
  screen?.postMessage({
    type: 'screen', show: snap.onScreen && live, code: snap.code, url,
    quiz: showQuiz && view ? { view, stage: snap.stage } : null,
    clouds: live ? snap.clouds : {},
  } satisfies ScreenMessage);
}

/** Resends the deck to every phone after an edit, so they never show a stale copy. */
function scheduleResend() {
  window.clearTimeout(resendTimer);
  resendTimer = window.setTimeout(() => {
    for (const [, c] of conns) void deliver(c.conn, c.role);
  }, 1500);
}

async function start(deckId: string) {
  if (snap.status === 'live' && snap.deckId === deckId) return;
  if (snap.status !== 'idle') stop();
  const stored = await db.decks.get(deckId);
  if (!stored) { set({ status: 'error', error: 'This deck no longer exists.', deckId }); return; }
  deck = stored;
  quiz = new QuizEngine(snap.quizSettings);
  quiz.setSlides(visibleSlides());
  set({ status: 'starting', error: null, deckId, title: stored.title, guests: [], votes: {}, clouds: {}, state: null, quiz: null, quizBoard: [], stage: 'play' });

  let opened: Peer | null = null;
  let code = '';
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    code = newCode();
    try {
      opened = await openPeer(peerIdFor(code));
    } catch (err) {
      if ((err as { type?: string }).type !== 'unavailable-id' || attempt === 2) {
        if (snap.deckId === deckId) set({ status: 'error', error: peerErrorMessage(err) });
        return;
      }
    }
  }
  // Stopped or switched decks while connecting.
  if (snap.deckId !== deckId || snap.status !== 'starting' || !opened) { opened?.destroy(); return; }

  peer = opened;
  peer.on('connection', onConnection);
  peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
  peer.on('error', (err) => {
    if ((err as { type?: string }).type === 'peer-unavailable') return;
    set({ error: peerErrorMessage(err) });
  });

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`lectern:${deckId}`);
    channel.onmessage = (e: MessageEvent<{ type: string; from: string; state?: LiveState }>) => {
      const msg = e.data;
      if (!msg || msg.from === bridgeId) return;
      if (msg.type === 'state' && msg.state) {
        set({ state: msg.state });
        broadcast({ t: 'state', state: msg.state });
        followShow(msg.state);
      } else if (msg.type === 'hello' && snap.state) {
        channel?.postMessage({ type: 'state', from: bridgeId, state: snap.state, at: Date.now() });
      }
    };
    // Ask open presenter windows where they are.
    channel.postMessage({ type: 'hello', from: bridgeId });
    screen = new BroadcastChannel(`lectern-live:${deckId}`);
    screen.onmessage = (e: MessageEvent<ScreenMessage>) => { if (e.data?.type === 'ask') postScreen(); };
  }

  let lastUpdated = stored.updatedAt;
  deckWatch = liveQuery(() => db.decks.get(deckId)).subscribe({
    next: (d) => {
      if (!d) return;
      deck = d;
      quiz.setSlides(visibleSlides());
      if (snap.title !== d.title) set({ title: d.title });
      if (d.updatedAt !== lastUpdated) { lastUpdated = d.updatedAt; scheduleResend(); }
    },
  });

  set({ status: 'live', code, token: newToken() });
  publishQuiz();
}

function stop() {
  broadcast({ t: 'bye' });
  const closing = [...conns.values()].map((c) => c.conn);
  window.setTimeout(() => closing.forEach((c) => { try { c.close(); } catch { /* already closed */ } }), 300);
  conns.clear();
  votes.clear();
  words.clear();
  hiddenWords.clear();
  cloudsDue.clear();
  window.clearTimeout(cloudTimer);
  cloudTimer = undefined;
  packages.clear();
  window.clearTimeout(resendTimer);
  window.clearTimeout(quizTimer);
  window.clearTimeout(publishTimer);
  publishTimer = undefined;
  deckWatch?.unsubscribe();
  deckWatch = null;
  const p = peer;
  peer = null;
  window.setTimeout(() => p?.destroy(), 400);
  set({ onScreen: false });
  postScreen();
  channel?.close();
  screen?.close();
  channel = null;
  screen = null;
  deck = null;
  set({ ...idle(), options: snap.options, panel: snap.panel, quizSettings: snap.quizSettings });
}

function setOptions(patch: Partial<ShareOptions>) {
  const options = { ...snap.options, ...patch };
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch { /* private mode */ }
  set({ options });
  broadcast({ t: 'options', options }, undefined, 'audience');
  // Takeaways change what viewers' copies contain.
  if ('shareTakeaways' in patch) {
    for (const [, c] of conns) if (c.role === 'audience') void deliver(c.conn, 'audience');
  }
}

function showOnScreen(show: boolean) {
  set({ onScreen: show });
  postScreen();
}

export const liveHost = {
  start,
  stop,
  setOptions,
  showOnScreen,
  openPanel(deckId: string) { set({ panel: { open: true, deckId } }); },
  closePanel() { set({ panel: { open: false, deckId: snap.panel.deckId } }); },
  /** Moves the slides from the computer, as a presenter window would. */
  setState(state: LiveState) {
    set({ state });
    channel?.postMessage({ type: 'state', from: bridgeId, state, at: Date.now() });
    broadcast({ t: 'state', state });
    followShow(state);
  },
  setQuizSettings(patch: Partial<QuizSettings>) {
    const quizSettings = { ...snap.quizSettings, ...patch };
    try { localStorage.setItem(QUIZ_KEY, JSON.stringify(quizSettings)); } catch { /* private mode */ }
    quiz.settings = { ...quizSettings };
    set({ quizSettings });
    if (snap.state) quiz.follow(visibleSlides()[snap.state.index], snap.state.step, Date.now());
    publishQuiz();
  },
  setStage(stage: QuizStage) {
    set({ stage });
    publishQuiz();
  },
  /** Clears every answer and score so the quiz can start again. */
  resetQuiz() {
    quiz.reset();
    set({ stage: 'play' });
    if (snap.state) quiz.follow(visibleSlides()[snap.state.index], snap.state.step, Date.now());
    publishQuiz();
  },
  quizResults(): QuizResults {
    return quiz.results();
  },
  clearVotes(slideId: string) {
    votes.delete(slideId);
    const next = { ...snap.votes };
    const slide = visibleSlides().find((s) => s.id === slideId);
    const result: PollResult = { counts: new Array(pollChoices(slide)?.length ?? 0).fill(0), total: 0 };
    delete next[slideId];
    set({ votes: next });
    broadcast({ t: 'votes', slideId, result });
  },
  /** Empties a word cloud, hidden words included. */
  clearWords(slideId: string) {
    words.delete(slideId);
    hiddenWords.delete(slideId);
    publishCloud(slideId);
  },
  /** Takes a word off the cloud on every screen. Phones that sent it keep it in their own list. */
  hideWord(slideId: string, text: string) {
    const hidden = hiddenWords.get(slideId) ?? new Set<string>();
    hidden.add(wordKey(text));
    hiddenWords.set(slideId, hidden);
    publishCloud(slideId);
  },
  /** Stores the cloud's words in the slide, so it keeps them after the session and in exports. */
  async keepWords(slideId: string): Promise<boolean> {
    const result = snap.clouds[slideId];
    const id = snap.deckId;
    if (!result?.words.length || !id) return false;
    const stored = await db.decks.get(id);
    const slide = stored?.slides.find((s) => s.id === slideId);
    if (!stored || !slide) return false;
    const answers = result.words.slice(0, 40).map((w) => ({ text: w.text, count: String(w.count) }));
    await saveDeck({ ...stored, slides: stored.slides.map((s) => (s.id === slideId ? { ...s, content: { ...s.content, answers } } : s)) });
    return true;
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  get snapshot() { return snap; },
};

export function useLiveHost(): HostSnapshot {
  return useSyncExternalStore(liveHost.subscribe, () => snap);
}

/** Opens the share panel for a deck. */
export function openShare(deckId: string) {
  liveHost.openPanel(deckId);
}

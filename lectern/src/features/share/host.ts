// The sharing session on the presenter's computer. It lives outside React so it
// keeps running while you move between the studio, presenter view and slides.
//
// It joins the same BroadcastChannel the presenter windows use (see present/sync.ts):
// slide changes made on the computer go out to phones, and the presenter's phone
// can move the slides on the computer.
//
// It also survives a reload of this page. The session is kept in this browser (session-store.ts)
// and picked up again with the same code, scores and slide, so the QR code on the wall keeps
// working and phones find their way back by themselves. Only "Stop sharing" ends it for them.

import { liveQuery } from 'dexie';
import type { DataConnection, Peer } from 'peerjs';
import { useSyncExternalStore } from 'react';
import type { Deck } from '../../core/deck/types';
import { getTheme, isBuiltInTheme } from '../../core/engine/themes';
import {
  AWAY_FOR, type CloudResult, DEFAULT_OPTIONS, GONE_AFTER, type GuestMessage, type HostMessage, type JoinMetadata, type LiveState, type MineView, PING_EVERY, type PollResult,
  type Role, type SharePackage, type ShareOptions, assetIds, cleanWord, cloudLimit, deckForRole, joinUrl, newCode, newToken, peerIdFor, pollChoices,
  sharedAsset, splitParts, tally, tallyWords, wordKey,
} from '../../core/share/protocol';
import {
  type BoardRow, DEFAULT_QUIZ, QuizEngine, type QuizResults, type QuizSettings, type QuizStage, type QuizView,
} from '../../core/share/quiz';
import { db } from '../../data/db';
import { saveDeck } from '../../data/repo';
import { backoff, heartbeat, keepAwake, openPeer, peerErrorMessage } from './peer';
import { type SavedSession, clearSession, holdSession, letGoOfSession, saveSession, savedSessions, siteAccess } from './session-store';

export interface GuestInfo {
  id: string;
  role: Role;
  device: string;
  /** The phone's stable id, the same after it reconnects. */
  player: string;
  /** The name it gave for the leaderboard. */
  name?: string;
  ready: boolean;
  since: number;
  /** Since when its link has been lost. It usually comes back by itself. */
  awaySince?: number;
}

export interface HostSnapshot {
  status: 'idle' | 'starting' | 'live' | 'error';
  error: string | null;
  /**
   * The link to the connection service, which introduces new phones. While it is down,
   * phones already connected carry on; new ones can join once it is back.
   */
  signal: 'up' | 'down';
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
  /** This session was picked up again after the page reloaded. */
  resumed: boolean;
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
  status: 'idle', error: null, signal: 'up', deckId: null, title: '', code: null, token: null, options: loadOptions(),
  guests: [], state: null, votes: {}, clouds: {}, onScreen: false, panel: { open: false, deckId: null },
  quizSettings: loadQuizSettings(), quiz: null, quizBoard: [], stage: 'play', resumed: false,
});

let snap: HostSnapshot = idle();
const listeners = new Set<() => void>();

function set(patch: Partial<HostSnapshot>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
  if (snap.status === 'live') keepSoon();
}

// Session resources, alive while sharing.
let peer: Peer | null = null;
let channel: BroadcastChannel | null = null;
let screen: BroadcastChannel | null = null;
let deckWatch: { unsubscribe(): void } | null = null;
let deck: Deck | null = null;
let resendTimer: number | undefined;
/** Each phone's link. `heard` is when it last sent anything; `pongs` that it answers pings (older apps don't). */
const conns = new Map<string, { conn: DataConnection; role: Role; player: string; heard: number; pongs: boolean }>();
let stopTicker: (() => void) | null = null;
let signalTries = 0;
let signalTimer: number | undefined;
let quiz = new QuizEngine(loadQuizSettings());
let quizTimer: number | undefined;
let publishTimer: number | undefined;
let keepTimer: number | undefined;
/** Goes up when a session ends, so work still under way for it stops. */
let sessionRun = 0;
let opening = false;
/** Slide → phone (its stable id) → its choice. */
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
  const next: GuestInfo = { id, role: 'audience', device: 'Device', player: id, ready: false, since: Date.now(), ...prev, ...patch };
  set({ guests: [...others, next].sort((a, b) => a.since - b.since) });
}

// --- Keeping the session ----------------------------------------------------

/** Writes the session down, so a reload can pick it up. */
function keepNow() {
  window.clearTimeout(keepTimer);
  keepTimer = undefined;
  if (snap.status !== 'live' || !snap.code || !snap.token || !snap.deckId) return;
  saveSession({
    code: snap.code, token: snap.token, deckId: snap.deckId, title: snap.title, at: Date.now(),
    state: snap.state, stage: snap.stage, onScreen: snap.onScreen, quiz: quiz.dump(),
    votes: [...votes].map(([slide, m]) => [slide, [...m]]),
    words: [...words].map(([slide, m]) => [slide, [...m]]),
    hidden: [...hiddenWords].map(([slide, s]) => [slide, [...s]]),
  });
}

function keepSoon() {
  if (keepTimer === undefined) keepTimer = window.setTimeout(keepNow, 500);
}

/** Sets up what a live session needs, for a new one or one being picked up again. */
function restoreAnswers(saved: SavedSession) {
  votes.clear();
  words.clear();
  hiddenWords.clear();
  for (const [slide, list] of saved.votes ?? []) votes.set(slide, new Map(list));
  for (const [slide, list] of saved.words ?? []) words.set(slide, new Map(list));
  for (const [slide, list] of saved.hidden ?? []) hiddenWords.set(slide, new Set(list));
}

/** What the computer has from one phone. */
function mineOf(player: string, refused?: string[]): { t: 'mine' } & MineView {
  const myVotes: Record<string, number> = {};
  for (const [slide, m] of votes) { const v = m.get(player); if (v !== undefined) myVotes[slide] = v; }
  const myWords: Record<string, string[]> = {};
  for (const [slide, m] of words) { const w = m.get(player); if (w?.length) myWords[slide] = w; }
  return { t: 'mine', answers: quiz.answersOf(player), votes: myVotes, words: myWords, ...(refused?.length ? { refused } : {}) };
}

/** Tells every phone what the computer has from it, after answers were cleared here. */
function pushMine() {
  for (const [id, c] of conns) {
    if (snap.guests.find((g) => g.id === id)?.ready) send(c.conn, mineOf(c.player));
  }
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

/** Largest video or sound file sent to phones. */
const PHONE_MEDIA_MAX = 8 * 1024 * 1024;

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
    // Big video and sound files stay on the main screen. Phones show a still, or say the sound plays there.
    if (asset && !(/^(video|audio)\//.test(asset.mime) && asset.blob.size > PHONE_MEDIA_MAX)) assets.push(sharedAsset(asset, await blobToDataUrl(asset.blob)));
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
    send(conn, { t: 'welcome', role, title: deck.title, parts: 0, bytes: 0, same: true, acks: true });
  } else {
    const json = await packageFor(role);
    if (!json) return;
    const parts = splitParts(json);
    send(conn, { t: 'welcome', role, title: deck.title, parts: parts.length, bytes: json.length, acks: true });
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
  // A phone that reloaded has forgotten these.
  send(conn, { t: 'options', options: snap.options });
  if (snap.state) send(conn, { t: 'state', state: snap.state });
  for (const [slideId, result] of Object.entries(snap.votes)) send(conn, { t: 'votes', slideId, result });
  for (const [slideId, result] of Object.entries(snap.clouds)) send(conn, { t: 'words', slideId, result });
  const c = conns.get(conn.peer);
  if (c) {
    send(conn, { t: 'quiz', quiz: quiz.view(role, Date.now(), role === 'presenter' ? 10 : 5), stage: snap.stage });
    if (role === 'audience') {
      send(conn, { t: 'you', you: quiz.playerView(c.player) });
      send(conn, mineOf(c.player));
    }
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
    // A phone that reconnects comes back with a new link: let go of its old one. If that link is
    // still alive, the phone has this deck open twice, and the older copy has to stop trying,
    // or the two would push each other off for ever.
    for (const [id, c] of conns) {
      if (id !== conn.peer && c.player === player && c.role === role) {
        send(c.conn, { t: 'replaced' });
        dropGuest(id);
      }
    }
    const back = snap.guests.filter((g) => g.awaySince !== undefined && g.player === player && g.role === role);
    if (back.length) set({ guests: snap.guests.filter((g) => !back.includes(g)) });
    conns.set(conn.peer, { conn, role, player, heard: Date.now(), pongs: false });
    const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim().slice(0, 24) : undefined;
    if (role === 'audience') { quiz.join(player, name); publishSoon(); }
    guestsChanged(conn.peer, { role, player, name, device: typeof meta.device === 'string' ? meta.device.slice(0, 40) : 'Device', ready: false, since: Date.now(), awaySince: undefined });
    void deliver(conn, role, typeof meta.have === 'number' ? meta.have : undefined);
  });
  conn.on('data', (raw) => onGuestMessage(conn, raw as GuestMessage));
  // Most phones that lose their link come back by themselves: the presenter sees them as reconnecting.
  const drop = () => {
    if (conns.get(conn.peer)?.conn !== conn) return;
    conns.delete(conn.peer);
    guestsChanged(conn.peer, { ready: false, awaySince: Date.now() });
  };
  conn.on('close', drop);
  // One message that was too big to send doesn't mean the phone is gone.
  conn.on('error', (err) => { if ((err as { type?: string }).type !== 'message-too-big') drop(); });
}

function visibleSlides() {
  return deck?.slides.filter((s) => !s.hidden) ?? [];
}

function dropGuest(id: string) {
  const c = conns.get(id);
  if (!c) return;
  conns.delete(id);
  try { c.conn.close(); } catch { /* already closed */ }
  guestsChanged(id, null);
}

// --- Staying connected ----------------------------------------------------

/** Reconnects to the connection service, waiting longer after each failed try. */
function reconnectSignal(now = false) {
  const p = peer;
  if (!p || p.destroyed || !p.disconnected || signalTimer !== undefined) return;
  signalTries += 1;
  set({ signal: 'down' });
  signalTimer = window.setTimeout(() => {
    signalTimer = undefined;
    if (peer !== p || p.destroyed || !p.disconnected) return;
    try { p.reconnect(); } catch { /* destroyed meanwhile */ }
  }, now ? 0 : backoff(signalTries, 1000, 20_000));
}

/** Right away when the computer is back online or back on screen, rather than at the next try. */
function reconnectNow() {
  if (!peer?.disconnected) return;
  window.clearTimeout(signalTimer);
  signalTimer = undefined;
  reconnectSignal(true);
}

function onVisible() {
  if (document.visibilityState === 'visible') reconnectNow();
}

/** Opens the link to the connection service under this session's code, and keeps trying until it works. */
async function openSignal(code: string) {
  if (opening) return;
  opening = true;
  const mine = sessionRun;
  set({ signal: 'down' });
  try {
    for (let tries = 1; mine === sessionRun; tries++) {
      try {
        const opened = await openPeer(peerIdFor(code));
        if (mine !== sessionRun) { opened.destroy(); return; }
        attachPeer(opened);
        return;
      } catch {
        // The service may still hold the code for a moment after a reload.
        await new Promise((r) => { window.setTimeout(r, backoff(tries, 1500, 20_000)); });
      }
    }
  } finally {
    opening = false;
  }
}

/** Every few seconds, also in a background tab: pings phones, lets go of silent ones, keeps the service link alive. */
function tick() {
  const now = Date.now();
  // Timers in a background tab are slowed: quiz updates and the timer running out go out from here.
  if (publishTimer !== undefined || quiz.tick(now)) publishQuiz();
  const stale = snap.guests.filter((g) => g.awaySince !== undefined && now - g.awaySince > AWAY_FOR);
  if (stale.length) set({ guests: snap.guests.filter((g) => !stale.includes(g)) });
  if (snap.status === 'live') keepNow();
  const p = peer;
  if (!p) return;
  if (document.visibilityState === 'hidden') heartbeat(p);
  for (const [id, c] of conns) {
    if (c.pongs && now - c.heard > GONE_AFTER) { dropGuest(id); continue; }
    if (snap.guests.find((g) => g.id === id)?.ready) send(c.conn, { t: 'ping', at: now });
  }
  // A link to the service that dropped without telling.
  if (p.disconnected && !p.destroyed) reconnectSignal();
  // The service link is gone for good: open a new one under the same code.
  if (p.destroyed && snap.code) {
    peer = null;
    void openSignal(snap.code);
  }
}

function onGuestMessage(conn: DataConnection, msg: GuestMessage) {
  const guest = conns.get(conn.peer);
  const role = guest?.role;
  if (!guest || !role || !msg || typeof msg !== 'object') return;
  guest.heard = Date.now();
  if (msg.t === 'pong') {
    guest.pongs = true;
  } else if (msg.t === 'state' && role === 'presenter') {
    set({ state: msg.state });
    channel?.postMessage({ type: 'state', from: bridgeId, state: msg.state, at: Date.now() });
    broadcast({ t: 'state', state: msg.state }, conn.peer);
    followShow(msg.state);
  } else if (msg.t === 'answer') {
    if (role !== 'audience') return;
    const counted = quiz.answer(guest.player, msg.slideId, msg.choice, Date.now(), typeof msg.ago === 'number' ? msg.ago : 0);
    if (counted) publishSoon();
    send(conn, mineOf(guest.player, !counted && quiz.answersOf(guest.player)[msg.slideId] === undefined ? [msg.slideId] : undefined));
  } else if (msg.t === 'name') {
    if (role === 'audience' && typeof msg.name === 'string') {
      quiz.join(guest.player, msg.name);
      guestsChanged(conn.peer, { name: msg.name.trim().slice(0, 24) || undefined });
      publishSoon();
    }
  } else if (msg.t === 'stage') {
    if (role === 'presenter' && ['play', 'leaderboard', 'podium'].includes(msg.stage)) { set({ stage: msg.stage }); publishQuiz(); }
  } else if (msg.t === 'word') {
    if (role === 'audience' && !snap.options.polls) return;
    if (typeof msg.slideId === 'string' && typeof msg.text === 'string' && addWord(guest.player, msg.slideId, msg.text)) publishCloudSoon(msg.slideId);
    send(conn, mineOf(guest.player));
  } else if (msg.t === 'vote') {
    if (role === 'audience' && !snap.options.polls) return;
    const slide = visibleSlides().find((s) => s.id === msg.slideId);
    const choices = pollChoices(slide);
    if (!choices || !Number.isInteger(msg.choice) || msg.choice < 0 || msg.choice >= choices.length) return;
    // Counted per phone, not per link: a phone that reconnected still has one vote.
    const slideVotes = votes.get(msg.slideId) ?? new Map<string, number>();
    slideVotes.set(guest.player, msg.choice);
    votes.set(msg.slideId, slideVotes);
    const result = tally(slideVotes, choices.length);
    set({ votes: { ...snap.votes, [msg.slideId]: result } });
    broadcast({ t: 'votes', slideId: msg.slideId, result });
    send(conn, mineOf(guest.player));
  }
}

function postScreen() {
  const url = snap.code ? joinUrl(window.location.origin, snap.code, undefined, siteAccess()) : null;
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

  attachPeer(opened);
  openSession(stored, deckId);
  set({ status: 'live', code, token: newToken() });
  void holdSession(code);
  publishQuiz();
  keepNow();
}

/** Listens to a new link to the connection service. */
function attachPeer(opened: Peer) {
  peer = opened;
  signalTries = 0;
  set({ signal: 'up' });
  opened.on('connection', onConnection);
  // Back on the service after a reconnect.
  opened.on('open', () => { signalTries = 0; set({ signal: 'up' }); });
  opened.on('disconnected', () => reconnectSignal());
  opened.on('error', (err) => {
    const type = (err as { type?: string }).type;
    if (type === 'peer-unavailable') return;
    // Trouble with the service: the disconnected handler retries, and the panel says so.
    if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'unavailable-id'].includes(type ?? '')) return;
    set({ error: peerErrorMessage(err) });
  });
}

/** What a live session runs on, for a new one or one being picked up again. */
function openSession(stored: Deck, deckId: string) {
  stopTicker = keepAwake(tick, PING_EVERY);
  window.addEventListener('online', reconnectNow);
  document.addEventListener('visibilitychange', onVisible);

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
}

let resuming: Promise<boolean> | null = null;

function resume(): Promise<boolean> {
  resuming ??= pickUpSession().finally(() => { resuming = null; });
  return resuming;
}

/**
 * Picks up the session this browser was running before the page reloaded, if there is one and
 * no other tab has it. It comes back at once, and reaches the connection service when it can.
 */
async function pickUpSession(): Promise<boolean> {
  if (snap.status !== 'idle') return false;
  for (const saved of savedSessions()) {
    if (!(await holdSession(saved.code))) continue;
    const stored = await db.decks.get(saved.deckId);
    if (snap.status !== 'idle') { letGoOfSession(); return false; }
    if (!stored) { clearSession(saved.code); letGoOfSession(); continue; }
    deck = stored;
    quiz = new QuizEngine(snap.quizSettings);
    quiz.setSlides(visibleSlides());
    quiz.restore(saved.quiz);
    restoreAnswers(saved);
    const clouds: Record<string, CloudResult> = {};
    for (const [slide, m] of words) clouds[slide] = tallyWords(m, hiddenWords.get(slide));
    const counted: Record<string, PollResult> = {};
    for (const [slide, m] of votes) {
      const choices = pollChoices(visibleSlides().find((s) => s.id === slide));
      if (choices) counted[slide] = tally(m, choices.length);
    }
    set({
      status: 'live', error: null, signal: 'down', deckId: saved.deckId, title: stored.title, code: saved.code, token: saved.token,
      guests: [], state: saved.state, votes: counted, clouds, onScreen: saved.onScreen, stage: saved.stage, resumed: true,
    });
    openSession(stored, saved.deckId);
    publishQuiz();
    void openSignal(saved.code);
    return true;
  }
  return false;
}

function stop() {
  sessionRun += 1;
  const ending = snap.code;
  broadcast({ t: 'bye' });
  if (ending) clearSession(ending);
  letGoOfSession();
  window.clearTimeout(keepTimer);
  keepTimer = undefined;
  stopTicker?.();
  stopTicker = null;
  window.clearTimeout(signalTimer);
  signalTimer = undefined;
  signalTries = 0;
  window.removeEventListener('online', reconnectNow);
  document.removeEventListener('visibilitychange', onVisible);
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
  snap = { ...snap, status: 'idle' };
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
  resume,
  /** Writes the session down now, for a page that is closing or reloading. */
  keepNow,
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
    pushMine();
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
    pushMine();
  },
  /** Empties a word cloud, hidden words included. */
  clearWords(slideId: string) {
    words.delete(slideId);
    hiddenWords.delete(slideId);
    publishCloud(slideId);
    pushMine();
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

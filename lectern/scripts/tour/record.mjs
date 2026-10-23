// Records the front page's tour video against the live site. Headless Chrome opens a director page
// (director.html, served from localhost) that shows the app in iframes. The app is on another origin, so this
// script reaches each frame through its own DevTools session: it finds elements there, then drives them with real
// mouse, key and drag input on the page, and saves the screencast frames.
// Waits for the AI are cut out of the recording. Each cut is labelled on screen with how long was skipped.
//
// The tour is recorded in three parts, so a retake never redrafts more than it must:
//   intro   the sample talk: key notes, present, presenter view, teleprompter, phone quiz. No AI.
//   make    two sample files and a brief become a deck with AI on /make. Costs real money on the site's key.
//   assist  the deck assistant changes that deck, then the deck on three devices. Costs money too.
// Usage, from lectern/ (frames take a few hundred MB, so point REC_ROOT at a roomy drive):
//   node scripts/tour/voice.mjs && node scripts/tour/music.mjs
//   node scripts/tour/record.mjs intro && node scripts/tour/record.mjs make && node scripts/tour/record.mjs assist
//   node scripts/tour/assemble.mjs
// `reset` records nothing: it puts the deck back as `make` left it, so `assist` can be taken again without redrafting.
// SITE overrides the app's address, CHROME the browser's path. STOP_BEFORE_AI=1 ends `make` and `assist` before they
// spend anything. Such a rehearsal records into <part>-dry, never over a real take, and `make` rehearses in a browser
// profile of its own, so the deck `assist` needs is kept.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PART = process.argv[2];
if (!['intro', 'make', 'assist', 'reset'].includes(PART)) throw new Error('Name a part: intro, make, assist or reset.');
const SITE = process.env.SITE ?? 'https://lectern-sooty.vercel.app';
// Keep this short: Chrome's IndexedDB fails under Windows' 260-character path limit.
const ROOT = process.env.REC_ROOT ?? join(tmpdir(), 'lectern-tour');
const DRY = process.env.STOP_BEFORE_AI === '1';
const OUT = join(ROOT, DRY ? `${PART}-dry` : PART);
const FRAMES = join(OUT, 'frames');
// make and assist share a browser profile: the deck made in one is changed in the other.
const PROFILE = join(ROOT, PART === 'intro' ? 'p-intro' : DRY && PART === 'make' ? 'p-dry' : 'p-ai');
const KEEP_PROFILE = PART === 'assist' || PART === 'reset';
const STATE = join(ROOT, 'ai-state.json');
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const HTTP = 4318;
const DARK = process.env.LIGHT !== '1';
const SAMPLES = join(HERE, 'samples');
const FILES = [join(SAMPLES, 'Greenway Q3 figures (sample).xlsx'), join(SAMPLES, 'Board brief (sample).docx')];

// The narration's lengths, so each shot lasts until its line is said.
const voiceList = join(ROOT, 'voice', 'lines.json');
const SPOKEN = existsSync(voiceList) ? JSON.parse(readFileSync(voiceList, 'utf8')) : {};

// ── The director, served from localhost with the app's own fonts ──
const fontDir = resolve(HERE, '../../node_modules/@fontsource-variable');
const FONT_FILES = {
  'inter.woff2': join(fontDir, 'inter/files/inter-latin-wght-normal.woff2'),
  'fraunces.woff2': join(fontDir, 'fraunces/files/fraunces-latin-wght-normal.woff2'),
  'fraunces-italic.woff2': join(fontDir, 'fraunces/files/fraunces-latin-wght-italic.woff2'),
};
const fonts = `
@font-face { font-family: 'Inter Variable'; font-weight: 100 900; src: url(/fonts/inter.woff2) format('woff2'); }
@font-face { font-family: 'Fraunces Variable'; font-weight: 100 900; src: url(/fonts/fraunces.woff2) format('woff2'); }
@font-face { font-family: 'Fraunces Variable'; font-style: italic; font-weight: 100 900; src: url(/fonts/fraunces-italic.woff2) format('woff2'); }`;
const directorHtml = readFileSync(join(HERE, 'director.html'), 'utf8').replace('/*FONTS*/', fonts);
const server = createServer((req, res) => {
  const font = req.url?.startsWith('/fonts/') && FONT_FILES[req.url.slice(7)];
  if (font) { res.writeHead(200, { 'content-type': 'font/woff2' }); res.end(readFileSync(font)); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(directorHtml);
});
await new Promise((r) => server.listen(HTTP, '127.0.0.1', r));

if (PART !== 'reset') rmSync(OUT, { recursive: true, force: true });
if (!KEEP_PROFILE) rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--hide-scrollbars', '--mute-audio', '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function waitJson(url) {
  for (let i = 0; i < 150; i++) {
    try { return await (await fetch(url)).json(); } catch { await sleep(200); }
  }
  throw new Error('Chrome did not start');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else listeners.forEach((l) => l(msg));
  };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const n = ++id; pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  return { ready, send, on: (l) => listeners.push(l), close: () => ws.close() };
}

const within = (p, ms) => Promise.race([p, sleep(ms).then(() => null)]);

const frames = [];
const marks = [];
const cues = [];
const skips = [];
const errors = [];
let recording = false;
// Seconds of real time cut out so far; frames and marks are kept on the video's own clock.
let cut = 0;
let acceptFrom = 0;
const now = () => Date.now() / 1000 - cut;
// A screenshot of the page, for when something goes wrong.
let snapshot = async () => {};

try {
  const ver = await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  const cdp = connect(ver.webSocketDebuggerUrl);
  await cdp.ready;
  const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).result;
  const s = (m, p) => cdp.send(m, p, sessionId);
  const MEDIA = { features: [{ name: 'prefers-color-scheme', value: DARK ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] };

  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Page.screencastFrame') {
      s('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
      const ts = msg.params.metadata.timestamp;
      if (!recording || ts < acceptFrom) return;
      const name = `${String(frames.length).padStart(6, '0')}.jpg`;
      writeFileSync(join(FRAMES, name), Buffer.from(msg.params.data, 'base64'));
      frames.push([name, ts - cut]);
    }
  });

  // Every frame of the app is on another origin, so Chrome runs it in its own process. Attach to each one,
  // and to the frames inside them (the quiz runs in a sandboxed frame inside the pack page).
  const frameSessions = new Map();
  cdp.on((msg) => {
    if (msg.method === 'Target.attachedToTarget' && msg.params.targetInfo.type === 'iframe') {
      const sid = msg.params.sessionId;
      frameSessions.set(sid, msg.params.targetInfo);
      void cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid);
      void cdp.send('Emulation.setEmulatedMedia', MEDIA, sid);
      void cdp.send('Runtime.enable', {}, sid);
      void cdp.send('Runtime.runIfWaitingForDebugger', {}, sid);
    }
    if (msg.method === 'Target.detachedFromTarget') frameSessions.delete(msg.params.sessionId);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  });
  await s('Runtime.enable');
  await s('Page.enable');
  await s('DOM.enable');
  await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await s('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await s('Emulation.setEmulatedMedia', MEDIA);
  await s('Page.navigate', { url: `http://localhost:${HTTP}/` });
  await sleep(1500);
  snapshot = async (name) => {
    const shot = await within(s('Page.captureScreenshot', { format: 'png' }), 5000);
    if (shot?.result?.data) writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
  };

  /** Runs in the director page. */
  const ev = async (expression) => {
    const r = (await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
    if (r.exceptionDetails) throw new Error(`${expression}\n${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  /** Runs in a frame's session; undefined when it fails or the frame is busy navigating. */
  async function frameEval(sid, expression, ms = 5000) {
    const r = await within(cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid), ms);
    if (!r?.result || r.result.exceptionDetails) return undefined;
    return r.result.result?.value;
  }
  // Each director frame has a name (A, B, P, D1…), which is the frame's window.name.
  const named = new Map();
  async function sessionOf(id) {
    const known = named.get(id);
    if (known && frameSessions.has(known) && await frameEval(known, 'window.name', 1500) === id) return known;
    for (const sid of [...frameSessions.keys()].reverse()) {
      if (await frameEval(sid, 'window.name', 1500) === id) { named.set(id, sid); return sid; }
    }
    return null;
  }
  /** Runs in director frame `id`; throws if it can't. */
  async function inFrame(id, expression) {
    const sid = await sessionOf(id);
    if (!sid) throw new Error(`Frame ${id} has no session`);
    const r = (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid)).result;
    if (r?.exceptionDetails) throw new Error(`${expression}\n${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r?.result?.value;
  }

  const mark = (label) => { marks.push({ label, t: now() }); console.log(`mark ${label}`); };
  const caption = (k, t, where) => ev(`dir.caption(${J(k)}, ${J(t)}, ${J(where ?? '')})`);
  const load = (id, path) => ev(`dir.load(${J(id)}, ${J(path.startsWith('http') ? path : SITE + path)})`);
  // Keys go to the focused frame.
  const focus = (id) => ev(`(() => { const f = document.getElementById(${J(id)}); f.focus(); f.contentWindow.focus(); })()`);

  /** Starts a line of the narration here. */
  const say = (id) => { cues.push({ id, t: now() }); };
  /** Waits until the line started with say(id) has been said, plus `pad` seconds. */
  async function said(id, pad = 0.35) {
    const cue = cues.findLast((c) => c.id === id);
    const length = SPOKEN[id]?.seconds ?? 0;
    if (!cue) return;
    const wait = (cue.t + length + pad - now()) * 1000;
    if (wait > 0) await sleep(wait);
  }

  const clock = (secs) => (secs < 60 ? `${Math.round(secs)} s` : `${Math.floor(secs / 60)} min ${String(Math.round(secs % 60)).padStart(2, '0')} s`);
  /**
   * Cuts a wait out of the video: recording stops, `until` runs, and recording starts again with a badge that
   * says what was skipped and for how long. Returns the seconds skipped.
   */
  async function skip(what, until) {
    const from = Date.now() / 1000;
    recording = false;
    await until();
    const secs = Date.now() / 1000 - from;
    await ev(`dir.skip(${J(`${clock(secs)} of ${what} skipped`)})`);
    cut += Date.now() / 1000 - from;
    acceptFrom = Date.now() / 1000;
    recording = true;
    skips.push({ what, secs: +secs.toFixed(1), t: now() });
    console.log(`cut ${clock(secs)} of ${what}`);
    return secs;
  }
  const unskip = () => ev(`dir.skip('')`);

  /** Waits until `find` (a selector, or a function of the frame's document) matches in frame `id`. */
  async function waitFor(id, find, ms = 15000) {
    const src = typeof find === 'string' ? J(find) : find.js ?? find;
    for (let t = 0; t < ms; t += 200) {
      const sid = await sessionOf(id);
      if (sid && await frameEval(sid, `(() => { try { const d = document; const f = ${src}; return Boolean(typeof f === 'string' ? d.querySelector(f) : f(d)); } catch { return false; } })()`)) return;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${src} in ${id}`);
  }

  /** An element's centre in page coordinates: found in its frame, then placed by the frame's spot on the page. */
  async function point(id, find) {
    const src = typeof find === 'string' ? J(find) : find.js ?? find;
    const p = await inFrame(id, `(async () => {
      const d = document; const f = ${src};
      const el = typeof f === 'string' ? d.querySelector(f) : f(d);
      if (!el) return null;
      let r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        r = el.getBoundingClientRect();
      }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!p) throw new Error(`Nothing matches ${src} in ${id}`);
    const o = await ev(`dir.frameRect(${J(id)})`);
    return { x: o.left + p.x * o.scale, y: o.top + p.y * o.scale };
  }

  async function press(p) {
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await ev(`dir.ring(${p.x}, ${p.y})`);
  }

  async function hover(id, find, mode) {
    const p = await point(id, find);
    await ev(`dir.cursor(${p.x}, ${p.y}, ${J(mode ?? '')})`);
    await sleep(720);
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    return p;
  }

  async function click(id, find, mode) {
    const p = await hover(id, find, mode);
    await press(p);
    return p;
  }

  /** A button in frame `id` by its text (exact, or a regular expression source), optionally inside `scope`. */
  const button = (text, scope = '') => ({ js: `(d) => [...d.querySelectorAll(${J(`${scope} button`.trim())})].find((b) => ${text instanceof RegExp ? `${text}.test(b.textContent.trim())` : `b.textContent.trim() === ${J(text)}`} && !b.disabled)` });

  async function wheel(id, find, deltaY) {
    const p = await point(id, find);
    await s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY });
  }

  const KEYS = { ArrowRight: [39, 'ArrowRight', '→'], ArrowLeft: [37, 'ArrowLeft', '←'], ArrowUp: [38, 'ArrowUp', '↑ faster'], Escape: [27, 'Escape', 'Esc'], Enter: [13, 'Enter', 'Enter ↵'] };
  async function key(k, show = true) {
    const [code, name, label] = KEYS[k];
    if (show) await ev(`dir.key(${J(label)})`);
    await s('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    if (k === 'Enter') await s('Input.dispatchKeyEvent', { type: 'char', key: k, code: name, text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  }

  async function type(text, perTick = 4, tick = 85) {
    for (let i = 0; i < text.length; i += perTick) {
      await s('Input.insertText', { text: text.slice(i, i + perTick) });
      await sleep(tick);
    }
  }

  /** The quiz runs in a sandboxed frame inside the pack page, which is inside director frame `outer`. */
  async function quizPoint(outer, selector) {
    for (let t = 0; t < 10000; t += 200) {
      let r = null;
      for (const sid of [...frameSessions.keys()].reverse()) {
        r = await frameEval(sid, `(() => { if (window.name || !document.getElementById('app')) return null; const el = document.querySelector(${J(selector)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, 1500);
        if (r) break;
      }
      if (r) {
        const o = await ev(`dir.frameRect(${J(outer)})`);
        const f = await inFrame(outer, `(() => { const f = document.querySelector('.pack-frame'); const r = f.getBoundingClientRect(); return { left: r.left, top: r.top, scale: r.width / f.offsetWidth }; })()`);
        return { x: o.left + (f.left + r.x * f.scale) * o.scale, y: o.top + (f.top + r.y * f.scale) * o.scale };
      }
      await sleep(200);
    }
    throw new Error(`No ${selector} in the quiz`);
  }

  async function tap(outer, selector) {
    const p = await quizPoint(outer, selector);
    await ev(`dir.cursor(${p.x}, ${p.y}, 'tap')`);
    await sleep(650);
    await press(p);
  }

  /** Real drag and drop of files from outside the page, with file cards under the pointer. */
  async function dropFiles(id, paths, target) {
    const names = paths.map((p) => basename(p));
    const from = { x: 150, y: 1010 };
    const to = await point(id, target);
    await ev(`dir.cursor(${from.x}, ${from.y}, 'jump'); dir.drag(${J(names)}, ${from.x + 8}, ${from.y + 12})`);
    await sleep(350);
    await ev(`dir.cursor(${to.x}, ${to.y}, 'slow'); dir.drag(null, ${to.x + 8}, ${to.y + 12})`);
    const data = { items: [], files: paths, dragOperationsMask: 1 };
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      // Roughly the director's easing, so the page sees the drag where the cards are.
      const k = 1 - (1 - i / steps) ** 3;
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k;
      await s('Input.dispatchDragEvent', { type: i === 0 ? 'dragEnter' : 'dragOver', x, y, data });
      await sleep(105);
    }
    await sleep(250);
    await s('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
    await ev(`dir.drag()`);
    await ev(`dir.ring(${to.x}, ${to.y})`);
  }

  /** Sets a labelled select in the /make settings, the way a person choosing it would. Off camera. */
  const setSelect = (id, label, value) => inFrame(id, `(() => {
    const field = [...document.querySelectorAll('label.field')].find((l) => l.querySelector('.field-label')?.textContent.trim().startsWith(${J(label)}));
    const select = field.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${J(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);

  const text = (id, selector) => inFrame(id, `document.querySelector(${J(selector)})?.textContent.trim() ?? ''`);
  const startRecording = async () => {
    await s('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    recording = true;
  };

  const AI_CARD = `<p class="eyebrow">Live on lectern-sooty.vercel.app</p><h1>Now a harder job, <em>with AI.</em></h1><p>Two sample files and a demanding brief, drafted by Claude Opus.</p>`;
  const END_CARD = `<div class="logo">{LOGO}</div><h1>Slides that know <em>what to say.</em></h1><p>Free to try. No sign-up. Your decks stay in your browser.</p><p class="url">lectern-sooty<span>.vercel.app</span></p><p class="credit">Narration voice: ElevenLabs</p>`;

  if (PART === 'intro') {
    // ── Before recording: the quiz link (from the front page) and the first shot ──
    await ev(`dir.card('<div class="logo">{LOGO}</div><h1>Slides that know <em>what to say.</em></h1><p>Lectern: a presentation tool with your script built into every slide.</p>')`);
    await load('A', '/welcome');
    await waitFor('A', '[data-testid="quiz-open-here"][href*="#"]');
    const quizUrl = await inFrame('A', `(() => { const u = new URL(document.querySelector('[data-testid="quiz-open-here"]').href); return u.pathname + u.hash; })()`);
    await load('A', '/studio/deck_meetings_talk');
    await waitFor('A', 'button.rail-thumb[aria-label^="Slide 4:"]');
    await sleep(1500);

    await startRecording();
    mark('Key notes');
    say('title');
    await sleep(2200);
    await said('title', 0.1);

    // ── 1. Key notes, in the studio ──
    void load('B', '/present/deck_meetings_talk?from=3');
    await ev(`dir.show('A'); dir.card('')`);
    await sleep(600);
    say('keynotes');
    await caption('Key notes', 'Every slide carries its own script, takeaways, a question for the room, cues and minutes.', 'right');
    await sleep(500);
    await click('A', 'button.rail-thumb[aria-label^="Slide 4:"]');
    await sleep(900);
    // Move in on the key notes under the slide, so they can be read.
    await ev('dir.hideCursor()');
    await caption('Key notes', 'Every slide carries its own script, takeaways, a question for the room, cues and minutes.', 'top');
    await ev(`dir.zoom('A', 1.5, 190, 270)`);
    await sleep(900);
    await hover('A', (d) => [...d.querySelectorAll('textarea')].find((t) => t.value.startsWith("Here's what the survey")));
    await sleep(900);
    await hover('A', (d) => [...d.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Takeaways for the audience'));
    await sleep(700);
    await hover('A', (d) => [...d.querySelectorAll('input, textarea')].find((t) => t.value.startsWith('At what size')));
    await said('keynotes', 0.2);
    await ev('dir.hideCursor()');
    await ev(`dir.zoom('A', 1)`);
    await sleep(300);

    // ── 2. Present mode ──
    mark('Present');
    await waitFor('B', '.slide-canvas');
    await ev(`dir.show('B')`);
    await focus('B');
    say('present');
    await caption('Present', 'The room sees only the slide. One click reveals the takeaway.', 'br');
    void load('A', '/presenter/deck_meetings_talk');
    await sleep(1500);
    await key('ArrowRight');
    await sleep(2000);
    await key('ArrowRight');
    await sleep(1300);
    await key('ArrowRight');
    await said('present', 0.5);

    // ── 3. Presenter view ──
    mark('Presenter view');
    await waitFor('A', '.slide-canvas');
    await ev(`dir.show('A')`);
    await focus('A');
    say('presenter');
    await caption('Presenter view', 'On your laptop: the script, the cues, the next slide and the clock.');
    void load('B', '/prompter/deck_meetings_talk');
    await sleep(2100);
    await key('ArrowRight');
    await sleep(2300);
    await key('ArrowRight');
    await said('presenter', 0.6);

    // ── 4. Teleprompter ──
    mark('Teleprompter');
    await waitFor('B', 'button[aria-label="Play"]');
    await ev(`dir.show('B')`);
    await focus('B');
    say('prompter');
    await caption('Teleprompter', 'Your script scrolls at speaking pace, big enough to read from across the room.', 'top');
    void load('P', quizUrl);
    await sleep(1000);
    await click('B', 'button[aria-label="Play"]');
    await ev('setTimeout(() => dir.hideCursor(), 900)');
    await sleep(1400);
    await key('ArrowUp');
    await sleep(500);
    await key('ArrowUp');
    await sleep(900);
    await said('prompter', 0.3);

    // ── 5. The phone quiz ──
    mark('Phone quiz');
    await ev(`dir.phoneCopy('Phone quiz', 'The quiz is in the link.', 'Phones join by scanning a QR code. The questions travel inside the link, and each phone scores them itself. Nothing to install, no sign-in.')`);
    await caption('', '');
    await ev(`dir.show('P')`);
    say('quiz');
    await sleep(900);
    await tap('P', '#go');
    await sleep(1000);
    await tap('P', 'button.choice[data-n="2"]');
    await sleep(1300);
    await tap('P', '#next');
    await sleep(700);
    await tap('P', 'button.choice[data-n="0"]');
    await sleep(900);
    await ev('dir.hideCursor()');
    await said('quiz', 0.3);

    // The AI part starts on this card.
    mark('End');
    await ev(`dir.card(${J(AI_CARD)})`);
    await sleep(900);
  }

  if (PART === 'make') {
    // ── Before recording: /make, with the settings chosen ──
    await ev(`dir.card(${J(AI_CARD)})`);
    await load('A', '/make');
    await waitFor('A', '.ad-ask-toggle input', 30000);
    await waitFor('A', (d) => !d.querySelector('section.ad-resume'));
    await setSelect('A', 'Kind of deck', 'report');
    await setSelect('A', 'Length', '10');
    await inFrame('A', `document.querySelector('button.ad-look[title="Campus"]').click()`);
    await inFrame('A', `(() => { const c = document.querySelector('.ad-ask-toggle input'); if (!c.checked) c.click(); return c.checked; })()`);
    await sleep(800);

    await startRecording();
    mark('Files and a brief');
    say('ai');
    await sleep(1600);
    await said('ai', 0.1);
    await ev(`dir.show('A'); dir.card('')`);
    await sleep(700);

    // ── 1. Two files and a brief ──
    say('files');
    await caption('Two sample files', 'A spreadsheet with three sheets of figures, and a board brief in Word.', 'left');
    await sleep(300);
    await dropFiles('A', FILES, '.ad-drop');
    await waitFor('A', (d) => d.querySelectorAll('li.ad-file.is-ready').length === 2, 20000);
    await sleep(900);
    await said('files', 0.2);

    say('brief');
    const BRIEF = 'A 10-minute board update. Make the case for 12 new stations, but be upfront about July’s dip and Hillcrest’s weak numbers. Two members are skeptical about cost: end on a clear decision, with one quick check before the vote.';
    await caption('The brief', 'Argue for the money, and be straight about the weak numbers.', 'left');
    await click('A', '.ad-brief textarea');
    await ev('dir.hideCursor()');
    await type(BRIEF, 5, 70);
    await sleep(500);
    await said('brief', 0.1);
    if (DRY) throw new Error('Stopped before the AI, as asked');
    await click('A', button('Make the deck', '.ad-go'));
    await sleep(1300);

    // ── 2. Questions, then the outline ──
    await skip('reading', () => waitFor('A', (d) => d.querySelector('dialog.ad-ask[open]') || d.querySelector('section.ol') || d.querySelector('.ad-error'), 180000));
    if (await text('A', '.ad-error')) throw new Error(`The make page said: ${await text('A', '.ad-error')}`);
    mark('Questions');
    say('questions');
    await caption('Questions first', 'Lectern asks before it plans. Any question can be skipped.', 'left');
    let answered = 0;
    for (let n = 0; n < 6; n++) {
      const q = await inFrame('A', `(() => { const d = document.querySelector('dialog.ad-ask[open]'); if (!d) return null; return { q: d.querySelector('.ad-ask-q')?.textContent ?? '', multiple: !!d.querySelector('.ad-ask-option[role="checkbox"]') }; })()`);
      if (!q) break;
      if (n === 0) { await sleep(1500); await unskip(); }
      if (answered >= 3) { await click('A', 'dialog.ad-ask button.ad-ask-now'); break; }
      console.log(`question: ${q.q}${q.multiple ? ' (multiple)' : ''}`);
      await sleep(700);
      if (q.multiple) {
        await click('A', 'dialog.ad-ask .ad-ask-option:nth-child(1)');
        await sleep(400);
        await click('A', 'dialog.ad-ask .ad-ask-option:nth-child(2)');
        await sleep(400);
        await click('A', (d) => d.querySelector('dialog.ad-ask .dialog-foot .btn-primary, dialog.ad-ask footer .btn-primary') ?? [...d.querySelectorAll('dialog.ad-ask button')].find((b) => /^(Next|Make the deck)$/.test(b.textContent.trim())));
      } else {
        await click('A', 'dialog.ad-ask .ad-ask-option:nth-child(1)');
      }
      answered++;
      await waitFor('A', { js: `(d) => { const x = d.querySelector('dialog.ad-ask[open]'); return !x || (x.querySelector('.ad-ask-q')?.textContent ?? '') !== ${J(q.q)}; }` }, 5000);
      await sleep(500);
    }
    await ev('dir.hideCursor()');
    await said('questions', 0.1);
    await sleep(900);
    const planned = (await inFrame('A', `Boolean(document.querySelector('section.ol'))`)) ? 0 : await skip('planning', () => waitFor('A', (d) => d.querySelector('section.ol') || d.querySelector('.ad-error'), 300000));
    if (await text('A', '.ad-error')) throw new Error(`The make page said: ${await text('A', '.ad-error')}`);

    mark('Outline');
    say('outline');
    const count = await inFrame('A', `document.querySelectorAll('li.ol-row').length`);
    await caption('The outline', `Claude Opus planned ${count} slides. Check them, then approve.`, 'left');
    await sleep(1800);
    await unskip();
    await hover('A', 'li.ol-row:nth-child(2) .ol-title');
    await sleep(500);
    await hover('A', 'li.ol-row:nth-child(4) .ol-title');
    await sleep(400);
    await wheel('A', 'li.ol-row:nth-child(4)', 420);
    await sleep(900);
    await said('outline', 0);
    await click('A', button(/Write the slides$/, '.ol-foot'));
    await sleep(500);

    // ── 3. Drafting, then the deck ──
    mark('Slides and notes');
    say('draft');
    await caption('Drafting', 'Claude writes each slide and its speaker notes, then checks every slide fits.', 'left');
    await ev('dir.hideCursor()');
    await sleep(2600);
    // "Drafting stopped" can show for a moment between batches and the saved deck; only a lasting one counts.
    const drafted = await skip('drafting', async () => {
      for (let t = 0, stopped = 0; t < 600000 && stopped < 25; t += 200) {
        if (await inFrame('A', `Boolean(document.querySelector('section.ad-result'))`).catch(() => false)) return;
        stopped = (await inFrame('A', `Boolean(document.querySelector('.ad-drafting-stop'))`).catch(() => false)) ? stopped + 1 : 0;
        await sleep(200);
      }
    });
    if (await text('A', '.ad-drafting-stop')) throw new Error(`Drafting stopped: ${await text('A', '.ad-drafting-stop')}`);
    const summary = await text('A', '.ad-result-head > p.muted');
    const usage = await text('A', 'details.ad-usage summary');
    await caption('Your deck', summary.replace(/ · Report · Adults$/, '').replace('slides with speaker notes', 'slides, each with speaker notes'), 'left');
    await sleep(1700);
    await unskip();
    await hover('A', 'details.ad-usage summary');
    await sleep(900);
    await said('draft', 0.1);
    await click('A', button(/Open in editor$/, '.ad-result-actions'));
    await waitFor('A', 'button.rail-thumb[aria-label^="Slide 1:"]', 20000);
    await ev('dir.hideCursor()');
    await caption('', '');
    await sleep(1400);
    mark('End');

    // What was made, for `assist` and for checking every claim in the video.
    const deckId = await inFrame('A', `location.pathname.split('/').pop()`);
    const facts = await inFrame('A', `new Promise((ok) => { const r = indexedDB.open('lectern'); r.onsuccess = () => { const db = r.result; const t = db.transaction(['decks', 'jobs'], 'readonly'); const decks = t.objectStore('decks').get(${J(deckId)}); const jobs = t.objectStore('jobs').getAll(); t.oncomplete = () => { const d = decks.result; ok({ title: d.title, slides: d.slides.map((x) => ({ id: x.id, kind: x.kind, heading: JSON.stringify(x.content).slice(0, 120), check: x.notes?.check ?? null })), usage: jobs.result.map((j) => j.usage) }); }; }; })`);
    writeFileSync(STATE, JSON.stringify({ deckId, summary, usage, count, planned, drafted, ...facts }, null, 1));
    console.log(`deck ${deckId}: ${summary} · ${usage}`);
  }

  if (PART === 'reset') {
    // The job keeps the deck as the AI wrote it. When the check after drafting only retimed it (nothing was
    // shortened or split), the deck `make` saved is that draft retimed, the same way fit.ts's retimeDeck does it.
    const { deckId } = JSON.parse(readFileSync(STATE, 'utf8'));
    await load('A', '/decks');
    await waitFor('A', 'main', 20000);
    const result = await inFrame('A', `new Promise((ok, fail) => {
      const half = (m) => Math.max(0.5, Math.round(m * 2) / 2);
      const minutesOf = (d) => d.slides.filter((s) => !s.hidden).reduce((a, s) => a + (s.notes?.minutes || 0), 0);
      const retime = (deck, target) => {
        const shown = deck.slides.filter((s) => !s.hidden);
        const planned = minutesOf(deck);
        const minutes = new Map(shown.map((s) => [s.id, half((s.notes.minutes || 0) * (target / planned))]));
        const longest = [...shown].sort((a, b) => (b.notes.minutes || 0) - (a.notes.minutes || 0)).map((s) => s.id);
        let drift = Math.round((target - [...minutes.values()].reduce((a, b) => a + b, 0)) * 2) / 2;
        for (let i = 0; drift !== 0 && i < longest.length * 4; i++) {
          const id = longest[i % longest.length];
          const m = minutes.get(id);
          const step = drift > 0 ? 0.5 : -0.5;
          if (m + step < 0.5) continue;
          minutes.set(id, m + step);
          drift -= step;
        }
        return deck.slides.map((s) => (minutes.has(s.id) ? { ...s, notes: { ...s.notes, minutes: minutes.get(s.id) } } : s));
      };
      const r = indexedDB.open('lectern');
      r.onerror = () => fail(r.error);
      r.onsuccess = () => {
        const db = r.result;
        const t = db.transaction(['decks', 'jobs'], 'readwrite');
        const jobs = t.objectStore('jobs').getAll();
        const cur = t.objectStore('decks').get(${J(deckId)});
        t.oncomplete = () => {
          const plan = jobs.result.find((j) => j.decks?.[0]?.deckId === ${J(deckId)})?.decks[0];
          const fit = plan?.fit;
          if (!fit || fit.undone || fit.report.fitted || fit.report.split || !cur.result) { ok({ error: 'The draft was changed by more than retiming, so it cannot be rebuilt', report: fit?.report }); return; }
          const slides = fit.report.retimed ? retime(fit.other, Number(fit.other.minutes)) : fit.other.slides;
          const now = new Map(cur.result.slides.map((s) => [s.id, s]));
          const same = slides.filter((s) => now.has(s.id) && JSON.stringify(now.get(s.id).content) === JSON.stringify(s.content) && now.get(s.id).kind === s.kind).length;
          if (same !== slides.length) { ok({ error: 'Some slides differ in more than their notes', same, of: slides.length }); return; }
          const deck = { ...cur.result, slides, updatedAt: Date.now() };
          const w = db.transaction('decks', 'readwrite');
          w.objectStore('decks').put(deck);
          w.oncomplete = () => ok({ restored: slides.length, removed: cur.result.slides.length - slides.length, minutes: minutesOf(deck) });
          w.onerror = () => fail(w.error);
        };
      };
    })`);
    console.log(JSON.stringify(result));
    if (result.error) throw new Error(result.error);
  }

  if (PART === 'assist') {
    const state = JSON.parse(readFileSync(STATE, 'utf8'));
    const deck = state.deckId;
    // ── Before recording: the deck in the editor, where `make` left it ──
    await ev(`dir.card('')`);
    await load('A', `/studio/${deck}`);
    await waitFor('A', 'button.rail-thumb[aria-label^="Slide 1:"]', 20000);
    await ev(`dir.show('A')`);
    // The phone joins a live share of the deck, as a phone in the room does after scanning its QR code. The share is
    // started in frame B, before recording, and relays the presenter's slide changes to the phone.
    await load('B', `/studio/${deck}`);
    await waitFor('B', 'button.rail-thumb[aria-label^="Slide 1:"]', 20000);
    await inFrame('B', `[...document.querySelectorAll('.studio-top button')].find((b) => b.textContent.trim().startsWith('Share')).click()`);
    await waitFor('B', button(/Start sharing$/, 'dialog'), 15000);
    await inFrame('B', `[...document.querySelectorAll('dialog button')].find((b) => b.textContent.trim().endsWith('Start sharing')).click()`);
    await waitFor('B', '.share-code-big', 40000);
    const code = (await inFrame('B', `document.querySelector('.share-code-big').getAttribute('aria-label')`)).replace(/^Code /, '').replace(/ /g, '');
    console.log(`sharing as ${code}`);
    await sleep(1800);

    await startRecording();
    mark('Plain-word changes');
    say('assistant');
    await caption('The assistant', 'Ask for changes across the whole deck, in plain words.', 'left');
    await sleep(600);
    await click('A', button(/Assistant\d*$/, '.studio-top'));
    await waitFor('A', '#assistant-input:not([disabled])');
    await click('A', '#assistant-input');
    await ev('dir.hideCursor()');
    const ASK = 'Two board members will push back on cost. Add a slide before the closing that breaks down what the $480,000 buys in three short points, and tighten every script to under 60 words.';
    await type(ASK, 5, 70);
    await sleep(500);
    // A dry run stops short of sending, and shows the deck as it is.
    let proposed = '';
    let added = null;
    let shownAt = 1;
    if (!DRY) {
      await key('Enter');
      await sleep(2200);
      await skip('the assistant working', () => waitFor('A', (d) => !d.querySelector('.assistant-working') && (d.querySelector('.assistant-review') || d.querySelector('.assistant-error') || d.querySelector('.assistant-reply')), 300000));
      if (await text('A', '.assistant-error')) throw new Error(`The assistant said: ${await text('A', '.assistant-error')}`);
      proposed = await text('A', '.assistant-changes h3');
      // What was proposed, for the caption after accepting. A slide the app says is too long ends the take.
      const kinds = await inFrame('A', `(() => {
        const titles = [...document.querySelectorAll('button.assistant-change-title')].map((b) => b.textContent.trim());
        const long = [...document.querySelectorAll('.assistant-change .chip-warn')].some((c) => c.textContent.includes('Too long'));
        return { added: titles.filter((t) => t.startsWith('New ')).length, notes: titles.filter((t) => t.startsWith('Key notes')).length, edits: titles.filter((t) => t.startsWith('Edit ')).length, long };
      })()`);
      console.log(`proposed: ${JSON.stringify(kinds)}`);
      if (kinds.long) throw new Error('The assistant proposed a slide that is too long for one slide');
      const accepted = [
        kinds.added && (kinds.added === 1 ? 'the new slide' : `${kinds.added} new slides`),
        kinds.notes && `${kinds.notes} tighter scripts`,
        kinds.edits && `${kinds.edits} reworded slide${kinds.edits === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' and ');
      await caption('', '');
      await sleep(1200);
      await unskip();
      // The new slide, previewed on the stage before anything changes.
      added = await inFrame('A', `(() => { const b = [...document.querySelectorAll('button.assistant-change-title')].find((x) => x.textContent.trim().startsWith('New ')); return b ? b.closest('.assistant-change').querySelector('.assistant-change-heading')?.textContent.trim() ?? '' : null; })()`);
      if (added !== null) {
        await click('A', (d) => [...d.querySelectorAll('button.assistant-change-title')].find((x) => x.textContent.trim().startsWith('New ')));
      } else {
        await click('A', 'button.assistant-change-title');
      }
      await caption('Preview', `${proposed}: each one is shown first, and nothing changes until you accept.`, 'left');
      await ev('dir.hideCursor()');
      await sleep(400);
      say('accept');
      await sleep(1800);
      await said('accept', 0.3);
      await click('A', '.assistant-review-actions .btn-primary');
      await sleep(900);
      if (added) {
        // An accepted slide is added after the one it follows; select it to show it as it now is.
        const rail = await inFrame('A', `(() => { const list = [...document.querySelectorAll('button.rail-thumb')]; const i = list.findIndex((b) => b.getAttribute('aria-label').includes(${J(added.slice(0, 40))})); return i; })()`);
        if (rail >= 0) { shownAt = rail; await click('A', `button.rail-thumb[aria-label^="Slide ${rail + 1}:"]`); }
      }
      await ev('dir.hideCursor()');
      await caption('Accepted', `${accepted.charAt(0).toUpperCase()}${accepted.slice(1)}, as one change you can undo.`, 'left');
    }

    void load('D1', `/present/${deck}?audience=1&from=${Math.max(0, shownAt)}`);
    void load('D3', `/join/${code}`);
    await said('assistant', 0.2);
    await said('accept', 0.2);
    await sleep(1200);
    void load('D2', `/presenter/${deck}`);
    await waitFor('D1', '.slide-canvas', 20000);
    await waitFor('D2', '.slide-canvas', 20000);
    await waitFor('D3', '.slide-canvas', 30000).catch(() => console.log('The phone did not show a slide'));
    await sleep(1200);

    // ── The deck on three devices, kept in step ──
    mark('Every screen');
    await caption('', '');
    await ev(`dir.show('devices')`);
    say('devices');
    await caption('Every screen', 'The laptop drives the room’s screen, and phones that scan the QR code follow along.', 'top');
    await focus('D2');
    await sleep(1600);
    await key('ArrowRight');
    await sleep(1500);
    await sleep(1100);
    await key('ArrowRight');
    await said('devices', 0.4);

    mark('End');
    await caption('', '');
    await ev('dir.hideCursor()');
    await ev(`dir.card(${J(END_CARD)})`);
    say('end');
    await sleep(800);
    await said('end', 1.2);
    if (!DRY) writeFileSync(STATE, JSON.stringify({ ...state, proposed, added, shownAt }, null, 1));
  }

  recording = false;
  if (PART === 'reset') throw Object.assign(new Error('done'), { done: true });
  await s('Page.stopScreencast');
  const t0 = frames[0][1];
  const at = (t) => +(t - t0).toFixed(2);
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify({
    frames: frames.map(([name, t]) => [name, at(t)]),
    marks: marks.map((m) => ({ label: m.label, at: at(m.t) })),
    cues: cues.map((c) => ({ id: c.id, at: at(c.t) })),
    skips: skips.map((x) => ({ ...x, t: at(x.t) })),
    end: at(now()),
  }, null, 1));
  console.log(`${frames.length} frames over ${at(now()).toFixed(1)} s of video`);
  console.log(marks.map((m) => `${m.label} @ ${at(m.t).toFixed(1)}`).join('\n'));
  if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
  cdp.close();
} catch (e) {
  if (!e.done) {
    console.log(`FAILED in ${PART}: ${e.message}`);
    await snapshot('failed');
    if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
    process.exitCode = 1;
  }
} finally {
  chrome.kill();
  server.close();
}

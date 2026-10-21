// Records the front page's tour video: headless Chrome plays a director page (director.html,
// copied into the build so it shares the app's origin) that shows the real app in iframes, while
// this script drives it with real mouse and key input and saves the screencast frames.
// Usage, from lectern/:
//   npm run build && npx vite preview --port 4173
//   node scripts/tour/record.mjs dist && node scripts/tour/assemble.mjs
// REC_ROOT holds the frames (about 300 MB) and the videos; CHROME overrides the browser's path.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.argv[2];
const BASE = process.env.BASE ?? 'http://localhost:4173';
// Keep this short: Chrome's IndexedDB fails under Windows' 260-character path limit.
const ROOT = process.env.REC_ROOT ?? join(tmpdir(), 'lectern-tour');
const OUT = join(ROOT, 'frames');
const PROFILE = join(ROOT, 'p');
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const DARK = process.env.LIGHT !== '1';

// The director, with the app's own fonts.
const assets = readdirSync(join(DIST, 'assets'));
const font = (re) => assets.find((f) => re.test(f));
const fonts = `
@font-face { font-family: 'Inter Variable'; font-weight: 100 900; src: url(/assets/${font(/^inter-latin-wght-normal-.*\.woff2$/)}) format('woff2'); }
@font-face { font-family: 'Fraunces Variable'; font-weight: 100 900; src: url(/assets/${font(/^fraunces-latin-wght-normal-.*\.woff2$/)}) format('woff2'); }
@font-face { font-family: 'Fraunces Variable'; font-style: italic; font-weight: 100 900; src: url(/assets/${font(/^fraunces-latin-wght-italic-.*\.woff2$/)}) format('woff2'); }`;
writeFileSync(join(DIST, '__director.html'), readFileSync(join(HERE, 'director.html'), 'utf8').replace('/*FONTS*/', fonts));

rmSync(OUT, { recursive: true, force: true });
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--hide-scrollbars', '--mute-audio', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const frames = [];
const marks = [];
const errors = [];
let recording = false;

try {
  const ver = await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  const cdp = connect(ver.webSocketDebuggerUrl);
  await cdp.ready;
  const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).result;
  const s = (m, p) => cdp.send(m, p, sessionId);

  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Page.screencastFrame') {
      s('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
      if (!recording) return;
      const name = `${String(frames.length).padStart(6, '0')}.jpg`;
      writeFileSync(join(OUT, name), Buffer.from(msg.params.data, 'base64'));
      frames.push([name, msg.params.metadata.timestamp]);
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  });

  // The quiz runs in a sandboxed frame, which Chrome keeps in its own process: attach to it as well.
  const frameSessions = [];
  cdp.on((msg) => {
    if (msg.method === 'Target.attachedToTarget' && msg.params.targetInfo.type === 'iframe') {
      frameSessions.push(msg.params.sessionId);
      cdp.send('Runtime.runIfWaitingForDebugger', {}, msg.params.sessionId);
    }
  });
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await s('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: DARK ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await s('Page.navigate', { url: `${BASE}/__director.html` });
  await sleep(1500);

  const ev = async (expression) => {
    const r = (await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
    if (r.exceptionDetails) throw new Error(`${expression}\n${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const J = JSON.stringify;
  const mark = (label) => { marks.push({ label, t: Date.now() / 1000 }); console.log(`mark ${label}`); };
  const caption = (k, t, where) => ev(`dir.caption(${J(k)}, ${J(t)}, ${J(where ?? '')})`);
  const load = (id, path) => ev(`dir.load(${J(id)}, ${J(BASE + path)})`);
  const focus = (id) => ev(`document.getElementById(${J(id)}).contentWindow.focus()`);

  /** Waits until `find` (a selector, or a function of the frame's document) matches in the frame. */
  async function waitFor(id, find, ms = 15000) {
    const src = typeof find === 'string' ? J(find) : find;
    for (let t = 0; t < ms; t += 150) {
      const ok = await ev(`(() => { try { const d = document.getElementById(${J(id)}).contentDocument; const f = ${src}; return Boolean(typeof f === 'string' ? d.querySelector(f) : f(d)); } catch { return false; } })()`);
      if (ok) return;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${src} in ${id}`);
  }

  async function press(p) {
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await ev(`dir.ring(${p.x}, ${p.y})`);
  }

  async function point(id, find) {
    const src = typeof find === 'string' ? J(find) : find;
    const p = await ev(`dir.point(${J(id)}, ${src})`);
    if (!p) throw new Error(`Nothing matches ${src} in ${id}`);
    return p;
  }

  async function hover(id, find, mode) {
    const p = await point(id, find);
    await ev(`dir.cursor(${p.x}, ${p.y}, ${J(mode ?? '')})`);
    await sleep(720);
    return p;
  }

  async function click(id, find, mode) {
    const p = await hover(id, find, mode);
    await press(p);
    return p;
  }

  const KEYS = { ArrowRight: [39, 'ArrowRight', '→'], ArrowLeft: [37, 'ArrowLeft', '←'], ArrowUp: [38, 'ArrowUp', '↑ faster'], Escape: [27, 'Escape', 'Esc'] };
  async function key(k) {
    const [code, name, label] = KEYS[k];
    await ev(`dir.key(${J(label)})`);
    await s('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  }

  async function type(text, perTick = 4, tick = 85) {
    for (let i = 0; i < text.length; i += perTick) {
      await s('Input.insertText', { text: text.slice(i, i + perTick) });
      await sleep(tick);
    }
  }

  /** The quiz runs in a sandboxed frame inside the pack page; reach into it through DevTools. */
  async function quizPoint(selector) {
    for (let t = 0; t < 8000; t += 150) {
      let r = null;
      for (const sid of [...frameSessions].reverse()) {
        const res = (await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => { if (!document.getElementById('app')) return null; const el = document.querySelector(${J(selector)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
        }, sid)).result;
        r = res?.result?.value ?? null;
        if (r) break;
      }
      if (r) {
        const outer = await ev(`dir.frameRect('P', '.pack-frame')`);
        return { x: outer.left + r.x * outer.scale, y: outer.top + r.y * outer.scale };
      }
      await sleep(150);
    }
    throw new Error(`No ${selector} in the quiz`);
  }

  async function tap(selector) {
    const p = await quizPoint(selector);
    await ev(`dir.cursor(${p.x}, ${p.y}, 'tap')`);
    await sleep(650);
    await press(p);
  }

  // ── Before recording: the quiz link (from the front page) and the first shot ──
  await ev(`dir.card('<div class="logo">{LOGO}</div><h1>Slides that know <em>what to say.</em></h1><p>Lectern: a presentation tool with your script built into every slide.</p>')`);
  await load('A', '/welcome');
  await waitFor('A', '[data-testid="quiz-open-here"][href*="#"]');
  const quizUrl = await ev(`new URL(document.getElementById('A').contentDocument.querySelector('[data-testid="quiz-open-here"]').href).pathname + new URL(document.getElementById('A').contentDocument.querySelector('[data-testid="quiz-open-here"]').href).hash`);
  await load('A', '/studio/deck_meetings_talk');
  await waitFor('A', 'button.rail-thumb[aria-label^="Slide 4:"]');
  await sleep(1200);

  await s('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  recording = true;
  mark('Key notes');
  await sleep(2600);

  // ── 1. Key notes, in the studio ──
  void load('B', '/present/deck_meetings_talk?from=3');
  await ev(`dir.show('A'); dir.card('')`);
  await sleep(700);
  await caption('Key notes', 'Every slide carries its own script, takeaways, a question for the room, cues and minutes.', 'right');
  await sleep(900);
  await click('A', 'button.rail-thumb[aria-label^="Slide 4:"]');
  await sleep(1200);
  // Move in on the key notes under the slide, so they can be read.
  await ev('dir.hideCursor()');
  await caption('Key notes', 'Every slide carries its own script, takeaways, a question for the room, cues and minutes.', 'top');
  await ev(`dir.zoom('A', 1.5, 190, 270)`);
  await sleep(1300);
  await hover('A', (d) => [...d.querySelectorAll('textarea')].find((t) => t.value.startsWith("Here's what the survey")));
  await sleep(1500);
  await hover('A', (d) => [...d.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Takeaways for the audience'));
  await sleep(1200);
  await hover('A', (d) => [...d.querySelectorAll('input, textarea')].find((t) => t.value.startsWith('At what size')));
  await sleep(1400);
  await ev('dir.hideCursor()');
  await ev(`dir.zoom('A', 1)`);
  await sleep(700);

  // ── 2. Present mode ──
  mark('Present');
  await ev('dir.hideCursor()');
  await waitFor('B', '.slide-canvas');
  await ev(`dir.show('B')`);
  await focus('B');
  await caption('Present', 'The room sees only the slide. One click reveals the takeaway.', 'br');
  void load('A', '/presenter/deck_meetings_talk');
  await sleep(1900);
  await key('ArrowRight');
  await sleep(2300);
  await key('ArrowRight');
  await sleep(1500);
  await key('ArrowRight');
  await sleep(2100);

  // ── 3. Presenter view ──
  mark('Presenter view');
  await waitFor('A', '.slide-canvas');
  await ev(`dir.show('A')`);
  await focus('A');
  await caption('Presenter view', 'On your laptop: the script, the cues, the next slide and the clock.');
  void load('B', '/prompter/deck_meetings_talk');
  await sleep(2600);
  await key('ArrowRight');
  await sleep(2600);
  await key('ArrowRight');
  await sleep(2200);

  // ── 4. Teleprompter ──
  mark('Teleprompter');
  await waitFor('B', 'button[aria-label="Play"]');
  await ev(`dir.show('B')`);
  await focus('B');
  await caption('Teleprompter', 'Your script scrolls at speaking pace, big enough to read from across the room.', 'top');
  void load('P', quizUrl);
  await sleep(1300);
  await click('B', 'button[aria-label="Play"]');
  await ev('setTimeout(() => dir.hideCursor(), 900)');
  await sleep(1600);
  await key('ArrowUp');
  await sleep(500);
  await key('ArrowUp');
  await sleep(4200);

  // ── 5. The phone quiz ──
  mark('Phone quiz');
  await ev(`dir.phoneCopy('Phone quiz', 'The quiz is in the link.', 'Phones join by scanning a QR code. The questions travel inside the link, and each phone scores them itself. Nothing to install, no sign-in.')`);
  await caption('', '');
  await ev(`dir.show('P')`);
  void load('A', '/decks?new=notes');
  await sleep(1400);
  await tap('#go');
  await sleep(1300);
  await tap('button.choice[data-n="2"]');
  await sleep(1700);
  await tap('#next');
  await sleep(1000);
  await tap('button.choice[data-n="0"]');
  await sleep(1300);
  await tap('#next');
  await sleep(1000);
  await tap('button.choice[data-n="2"]');
  await sleep(1300);
  await tap('#next');
  await ev('setTimeout(() => dir.hideCursor(), 700)');
  await sleep(2400);

  // ── 6. Notes to slides ──
  mark('Notes to slides');
  await waitFor('A', 'textarea');
  await ev(`dir.show('A')`);
  await focus('A');
  await caption('Notes to slides', 'Type rough notes. Lectern makes the slides and starter key notes, with no AI.');
  await sleep(900);
  await click('A', 'textarea');
  await ev('dir.hideCursor()');
  await caption('Notes to slides', 'Type rough notes. Lectern makes the slides and starter key notes, with no AI.', 'top');
  await ev(`dir.zoom('A', 1.45, 300, 12)`);
  await sleep(900);
  await type([
    '# Fewer, better meetings',
    '',
    '## The problem',
    '- 5 hours a week in meetings nobody rates',
    '- 1 in 3 end with no owner',
    '',
    '## Three fixes',
    '1. Decide: meet or message?',
    '2. Invite: purpose, outcome, prep',
    '3. Run: end with owners',
    '',
    '## Check',
    'Q: What goes in every invite?',
    'A) Purpose, outcome, prep *  B) An agenda',
  ].join('\n'));
  await sleep(1100);
  await ev(`dir.zoom('A', 1)`);
  await sleep(900);
  await click('A', (d) => [...d.querySelectorAll('button')].find((b) => /^Make \d+ slides$/.test(b.textContent.trim())));
  await waitFor('A', 'button.rail-thumb[aria-label^="Slide 3:"]');
  await caption('Notes to slides', 'A deck from those notes, each slide with starter key notes.', 'right');
  await sleep(1600);
  await click('A', 'button.rail-thumb[aria-label^="Slide 3:"]');
  await sleep(2200);

  // ── End card ──
  mark('End');
  await ev('dir.hideCursor()');
  await caption('', '');
  await ev(`dir.card('<div class="logo">{LOGO}</div><h1>Slides that know <em>what to say.</em></h1><p>Free to try. No sign-up. Your decks stay in your browser.</p><p class="url">lectern-sooty<span>.vercel.app</span></p>')`);
  await sleep(3800);

  recording = false;
  await s('Page.stopScreencast');
  const t0 = frames[0][1];
  writeFileSync(join(ROOT, 'frames.json'), JSON.stringify({ frames, marks: marks.map((m) => ({ label: m.label, at: +(m.t - t0).toFixed(2) })), end: Date.now() / 1000 - t0 }, null, 1));
  console.log(`${frames.length} frames over ${(frames.at(-1)[1] - t0).toFixed(1)} s`);
  console.log(marks.map((m) => `${m.label} @ ${(m.t - t0).toFixed(1)}`).join('\n'));
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
  cdp.close();
} finally {
  chrome.kill();
}

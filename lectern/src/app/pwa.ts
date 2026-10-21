// Installing Lectern as an app, and the service worker that keeps it opening offline.
//
// Lectern's data lives only in this browser, and an installed app is the safest place for it:
// Safari doesn't apply its 7-day limit to apps on the Home Screen or in the Dock, and Chrome
// and Edge give installed apps persistent storage.

import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** How Lectern can be installed in this browser. */
export type InstallWay =
  /** Running as the installed app, or just installed from this tab. */
  | 'installed'
  /** The browser's own install dialog is ready (Chrome, Edge, Samsung Internet). */
  | 'prompt'
  /** Safari on a Mac: Share → Add to Dock. */
  | 'dock'
  /** iPhone and iPad, in any browser: Share → Add to Home Screen. */
  | 'home-screen'
  /** Other browsers that install from their menu or address bar. */
  | 'menu'
  /** This browser can't install web apps, such as Firefox on a computer. */
  | 'none';

/** 'ready': a new version is waiting. 'applied': another tab switched to it. */
export type UpdateState = 'none' | 'ready' | 'applied';

export interface InstallEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** Opened as an installed app. */
  standalone: boolean;
  /** The browser offered its install dialog (beforeinstallprompt). */
  canPrompt: boolean;
  /** Installed from this tab during this visit. */
  installed: boolean;
  /** The install dialog was offered this visit and turned down. */
  declined: boolean;
}

/** iPhone or iPad. iPads ask for the desktop site and say they're a Mac, but they have touch. */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function installWay(env: InstallEnv): InstallWay {
  if (env.standalone || env.installed) return 'installed';
  if (env.canPrompt) return 'prompt';
  const ua = env.userAgent;
  if (isAppleMobile(ua, env.maxTouchPoints)) return 'home-screen';
  const otherEngine = /Chrome|Chromium|Edg\/|OPR\/|Firefox|SamsungBrowser/.test(ua);
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !otherEngine) return 'dock';
  if (env.declined || /Android/.test(ua)) return 'menu';
  return 'none';
}

/** Safari's way of installing: these browsers clear a site's data after 7 days without a visit. */
export function clearsIdleData(way: InstallWay): boolean {
  return way === 'dock' || way === 'home-screen';
}

/** "Safari", or "This browser" for Chrome, Firefox and Edge on iPhone and iPad, which use Safari's engine. */
export function idleClearerName(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  return /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent) ? 'This browser' : 'Safari';
}

// ─── State ────────────────────────────────────────────────────────────

let deferred: InstallPromptEvent | null = null;
let installed = false;
let declined = false;
let update: UpdateState = 'none';
let waiting: ServiceWorker | null = null;
let reloading = false;
const listeners = new Set<() => void>();

function standalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true
    || ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'].some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches);
}

function read() {
  const way = typeof navigator === 'undefined' ? 'none' : installWay({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: standalone(),
    canPrompt: Boolean(deferred),
    installed,
    declined,
  });
  return { way, update };
}

let snapshot = read();

function emit() {
  snapshot = read();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** How this browser installs Lectern, and whether a new version is waiting. */
export function usePwa(): { way: InstallWay; update: UpdateState } {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Shows the browser's install dialog. A dialog can only be shown once a visit. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') installed = true;
    else declined = true;
    return outcome;
  } catch {
    declined = true;
    return 'dismissed';
  } finally {
    emit();
  }
}

/** Reloads into the new version, switching to the waiting service worker first. */
export function applyUpdate() {
  const reload = () => { if (!reloading) return; reloading = false; window.location.reload(); };
  reloading = true;
  if (waiting && waiting.state === 'installed') {
    waiting.postMessage({ type: 'skip-waiting' });
    // If the switch never comes, reload anyway.
    window.setTimeout(reload, 4000);
  } else {
    reload();
  }
}

// ─── Start-up ─────────────────────────────────────────────────────────

const HOUR = 3_600_000;

function offer(worker: ServiceWorker) {
  // With no controller this is the first install, not an update.
  if (!navigator.serviceWorker.controller) return;
  waiting = worker;
  update = 'ready';
  emit();
}

function watch(worker: ServiceWorker | null) {
  if (!worker) return;
  const check = () => { if (worker.state === 'installed') offer(worker); };
  check();
  worker.addEventListener('statechange', check);
}

async function registerServiceWorker() {
  const sw = navigator.serviceWorker;
  let controlled = Boolean(sw.controller);
  sw.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; } // the first install taking over this page
    if (reloading) { reloading = false; window.location.reload(); return; }
    update = 'applied';
    emit();
  });
  const registration = await sw.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  if (registration.waiting) offer(registration.waiting);
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));
  // Tabs left open for days look for a new version when they come back into view.
  let checked = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - checked < HOUR) return;
    checked = Date.now();
    registration.update().catch(() => {});
  });
}

/** Listens for the browser's install offer and, in production builds, starts the service worker. */
export function initPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Lectern shows its own Install button in Preferences instead of the browser's banner.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
  // Phones joining a live deck are guests: they don't need the whole app downloaded.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || /^\/join(\/|$)/.test(window.location.pathname)) return;
  const start = () => { registerServiceWorker().catch((error) => console.warn('Lectern could not start offline support', error)); };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

// Keeps the screen awake while something long runs (recording a class, transcribing).
// Several holders can ask at once; the lock is released when the last one lets go.

interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

const holders = new Set<string>();
let sentinel: Sentinel | null = null;

async function acquire() {
  if (sentinel || !holders.size || document.visibilityState !== 'visible') return;
  const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (!api) return;
  try {
    const lock = await api.request('screen');
    sentinel = lock;
    lock.addEventListener('release', () => { if (sentinel === lock) sentinel = null; });
  } catch {
    // Denied (low battery, not visible): nothing to do.
  }
}

if (typeof document !== 'undefined') {
  // The browser drops the lock when the tab is hidden; take it back on return.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
}

export function holdWakeLock(key: string) {
  holders.add(key);
  acquire();
}

export function releaseWakeLock(key: string) {
  holders.delete(key);
  if (!holders.size && sentinel) {
    const s = sentinel;
    sentinel = null;
    s.release().catch(() => {});
  }
}

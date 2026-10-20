// Keeping this browser's data safe: asks the browser not to clear it, reports how much
// space it uses, and tells the app when a save fails because storage is full.

import type { DBCore, DBCoreMutateRequest, DBCoreTable, Middleware } from 'dexie';

/** True for the errors browsers raise when a site has no storage space left. */
export function isQuotaError(error: unknown): boolean {
  for (let e = error as { name?: unknown; message?: unknown; inner?: unknown } | null | undefined, depth = 0; e && depth < 4; e = e.inner as typeof e, depth++) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
    if (typeof e.message === 'string' && /quota|storage is full|no space|disk is full|not enough space/i.test(e.message)) return true;
  }
  return false;
}

const fullListeners = new Set<(error: unknown) => void>();

/** Calls the listener whenever a write fails for lack of space. Returns a function that stops listening. */
export function onStorageFull(listener: (error: unknown) => void): () => void {
  fullListeners.add(listener);
  return () => { fullListeners.delete(listener); };
}

/** Passes an error on to the storage-full listeners when it is a quota error. */
export function reportStorageError(error: unknown) {
  if (!isQuotaError(error)) return;
  for (const listener of fullListeners) listener(error);
}

/**
 * Dexie middleware that notices quota errors on every write, whether the request itself
 * fails or the browser aborts the transaction when it commits.
 */
export const quotaWatch: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'lectern-quota-watch',
  create(down) {
    return {
      ...down,
      transaction(stores, mode, options) {
        const tx = down.transaction(stores, mode, options);
        if (mode === 'readwrite' && tx && typeof (tx as unknown as EventTarget).addEventListener === 'function') {
          (tx as unknown as IDBTransaction).addEventListener('abort', () => reportStorageError((tx as unknown as IDBTransaction).error));
        }
        return tx;
      },
      table(name) {
        const table = down.table(name);
        return {
          ...table,
          mutate(req: DBCoreMutateRequest) {
            return table.mutate(req).catch((error: unknown) => {
              reportStorageError(error);
              throw error;
            });
          },
        } satisfies DBCoreTable;
      },
    };
  },
};

/**
 * Asks the browser to keep this site's data even when the disk runs low. Chrome and Edge
 * decide on their own from how much the site is used; Firefox may ask the person.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

let persistAsked = false;

/** Asks for persistent storage once per visit, the first time a deck is saved. Safe to call often. */
export function keepStorage() {
  if (persistAsked) return;
  persistAsked = true;
  void requestPersistence();
}

export interface StorageUsage {
  /** Bytes this site uses. */
  usage: number;
  /** Bytes the browser lets this site use. */
  quota: number;
  /** The browser has agreed not to clear this site's data by itself. */
  persisted: boolean;
}

/** How much space this site uses, or null where the browser doesn't say. */
export async function storageUsage(): Promise<StorageUsage | null> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.estimate) return null;
    const [estimate, persisted] = await Promise.all([storage.estimate(), storage.persisted?.() ?? Promise.resolve(false)]);
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
  } catch {
    return null;
  }
}

/** "820 KB", "24 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

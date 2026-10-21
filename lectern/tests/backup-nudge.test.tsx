import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DAY = 86_400_000;
const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
};

let root: Root | null = null;
let host: HTMLDivElement;

/** Loads the app's modules afresh, as a new visit in a browser with this user agent would. */
async function visit(userAgent: string, { edited = true, touch = 0, path = '/decks' } = {}) {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
  vi.resetModules();
  const { db } = await import('../src/data/db');
  const { loadSampleData, saveDeck } = await import('../src/data/repo');
  await Promise.all(db.tables.map((t) => t.clear()));
  await loadSampleData();
  if (edited) {
    const deck = (await db.decks.toArray())[0];
    await saveDeck({ ...deck, slides: deck.slides.slice(1) });
  }
  const { ToastProvider } = await import('../src/ui/Toast');
  const { BackupNudge } = await import('../src/features/backup/BackupNudge');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(ToastProvider, null, createElement(BackupNudge))));
  });
}

/** Leaves the Shell (for the studio, say) and comes back, in the same visit. */
async function leaveAndReturn() {
  const { ToastProvider } = await import('../src/ui/Toast');
  const { BackupNudge } = await import('../src/features/backup/BackupNudge');
  await act(async () => root!.unmount());
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(ToastProvider, null, createElement(BackupNudge))));
  });
}

/** Lets the reminder's deck check finish. */
async function settle() {
  for (let i = 0; i < 20; i++) await act(() => new Promise((r) => setTimeout(r, 10)));
}

const nudge = () => host.querySelector('.backup-nudge') as HTMLElement | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe('backup reminder', () => {
  it('stays hidden when there are only the samples', async () => {
    await visit(UA.chrome, { edited: false });
    await settle();
    expect(nudge()).toBeNull();
    expect(localStorage.getItem('lectern.backupReminder')).toBeNull();
  });

  it('shows once there is work and no backup, then dismisses', async () => {
    await visit(UA.chrome);
    await settle();
    expect(nudge()?.textContent).toContain('Back up your work.');
    expect(nudge()?.textContent).toContain('there’s no backup yet');
    expect(nudge()?.textContent).not.toContain('Safari');
    expect(nudge()?.querySelector('button')?.textContent?.trim()).toBe('Download a backup');
    expect(Number(localStorage.getItem('lectern.backupReminder'))).toBeGreaterThan(Date.now() - 60_000);

    await act(async () => (host.querySelector('[aria-label="Dismiss the backup reminder"]') as HTMLButtonElement).click());
    expect(nudge()).toBeNull();
  });

  it('stays for the rest of the visit until it is dismissed', async () => {
    await visit(UA.chrome);
    await settle();
    await leaveAndReturn();
    expect(nudge()?.textContent).toContain('Back up your work.');
    await act(async () => (host.querySelector('[aria-label="Dismiss the backup reminder"]') as HTMLButtonElement).click());
    await leaveAndReturn();
    expect(nudge()).toBeNull();
  });

  it('goes away when a backup is made somewhere else, such as Preferences', async () => {
    await visit(UA.chrome);
    await settle();
    localStorage.setItem('lectern.lastBackup', String(Date.now()));
    await leaveAndReturn();
    expect(nudge()).toBeNull();
  });

  it('says how old the last backup is', async () => {
    localStorage.setItem('lectern.lastBackup', String(Date.now() - 21 * DAY));
    await visit(UA.chrome);
    await settle();
    expect(nudge()?.textContent).toContain('the last backup was 3 weeks ago');
  });

  it('waits a week after showing', async () => {
    localStorage.setItem('lectern.backupReminder', String(Date.now() - 2 * DAY));
    await visit(UA.chrome);
    await settle();
    expect(nudge()).toBeNull();
  });

  it('stays quiet after a recent backup', async () => {
    localStorage.setItem('lectern.lastBackup', String(Date.now() - 3 * DAY));
    await visit(UA.chrome);
    await settle();
    expect(nudge()).toBeNull();
  });

  it('doesn’t show on Preferences, which has the backup panel', async () => {
    await visit(UA.chrome, { path: '/settings' });
    await settle();
    expect(nudge()).toBeNull();
    expect(localStorage.getItem('lectern.backupReminder')).toBeNull();
  });

  it('on Safari for Mac also suggests adding Lectern to the Dock', async () => {
    await visit(UA.safariMac);
    await settle();
    expect(nudge()?.textContent).toContain('Safari can also clear it after 7 days without a visit.');
    const link = nudge()?.querySelector('a');
    expect(link?.textContent).toBe('Add Lectern to your Dock');
    expect(link?.getAttribute('href')).toBe('/settings#your-data');
  });

  it('on iPhone suggests the Home Screen', async () => {
    await visit(UA.safariIphone, { touch: 5 });
    await settle();
    expect(nudge()?.querySelector('a')?.textContent).toBe('Add Lectern to your Home Screen');
  });
});

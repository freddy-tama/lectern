// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type InstallEnv, clearsIdleData, idleClearerName, installWay, isAppleMobile } from '../src/app/pwa';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
};

const env = (patch: Partial<InstallEnv>): InstallEnv => ({
  userAgent: UA.chromeWin, maxTouchPoints: 0, standalone: false, canPrompt: false, installed: false, declined: false, ...patch,
});

describe('how Lectern installs in each browser', () => {
  it('uses the browser’s own dialog when it offers one', () => {
    expect(installWay(env({ canPrompt: true }))).toBe('prompt');
    expect(installWay(env({ userAgent: UA.edgeWin, canPrompt: true }))).toBe('prompt');
  });

  it('knows when it already runs as an app', () => {
    expect(installWay(env({ standalone: true, canPrompt: true }))).toBe('installed');
    expect(installWay(env({ installed: true }))).toBe('installed');
    expect(installWay(env({ userAgent: UA.safariIphone, maxTouchPoints: 5, standalone: true }))).toBe('installed');
  });

  it('gives Safari’s steps on a Mac and on iPhone and iPad', () => {
    expect(installWay(env({ userAgent: UA.safariMac }))).toBe('dock');
    expect(installWay(env({ userAgent: UA.safariIphone, maxTouchPoints: 5 }))).toBe('home-screen');
    expect(installWay(env({ userAgent: UA.chromeIphone, maxTouchPoints: 5 }))).toBe('home-screen');
    // iPads ask for the desktop site, so they look like a Mac with touch.
    expect(installWay(env({ userAgent: UA.safariMac, maxTouchPoints: 5 }))).toBe('home-screen');
    expect(isAppleMobile(UA.safariMac, 0)).toBe(false);
  });

  it('doesn’t mistake Chrome or Firefox on a Mac for Safari', () => {
    expect(installWay(env({ userAgent: UA.chromeMac }))).toBe('none');
    expect(installWay(env({ userAgent: UA.firefoxMac }))).toBe('none');
    expect(installWay(env({ userAgent: UA.firefoxWin }))).toBe('none');
  });

  it('points to the browser menu on Android and after the dialog was turned down', () => {
    expect(installWay(env({ userAgent: UA.firefoxAndroid }))).toBe('menu');
    expect(installWay(env({ declined: true }))).toBe('menu');
  });

  it('flags the browsers that clear data after a week away', () => {
    expect(clearsIdleData('dock')).toBe(true);
    expect(clearsIdleData('home-screen')).toBe(true);
    for (const way of ['installed', 'prompt', 'menu', 'none'] as const) expect(clearsIdleData(way)).toBe(false);
    expect(idleClearerName(UA.safariIphone)).toBe('Safari');
    expect(idleClearerName(UA.safariMac)).toBe('Safari');
    expect(idleClearerName(UA.chromeIphone)).toBe('This browser');
  });
});

/** Width and height from a PNG's header. */
function pngSize(path: string) {
  const bytes = readFileSync(new URL(path, root));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('installable app', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));

  it('has a manifest that browsers accept for installing', () => {
    expect(manifest).toMatchObject({ name: 'Lectern', short_name: 'Lectern', start_url: '/', scope: '/', display: 'standalone' });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    const sizes = manifest.icons.filter((i: { type: string }) => i.type === 'image/png').map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('has every icon the manifest names, at the size it says', () => {
    for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
      const path = `public${icon.src}`;
      expect(existsSync(new URL(path, root)), path).toBe(true);
      if (icon.type === 'image/png') expect(pngSize(path)).toBe(icon.sizes);
    }
    expect(pngSize('public/icons/apple-touch-icon.png')).toBe('180x180');
  });

  it('links the manifest, the Apple icon and both theme colours from the page', () => {
    const html = read('index.html');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toMatch(/name="theme-color" content="#[0-9A-F]{6}" media="\(prefers-color-scheme: light\)"/i);
    expect(html).toMatch(/name="theme-color" content="#[0-9A-F]{6}" media="\(prefers-color-scheme: dark\)"/i);
  });
});

describe('Vercel config', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const headersFor = (path: string) => (vercel.headers as { source: string; headers: { key: string; value: string }[] }[])
    .filter((h) => new RegExp(`^${h.source.replace(/\(\.\*\)/g, '.*')}$`).test(path))
    .flatMap((h) => h.headers);
  const cacheControl = (path: string) => headersFor(path).filter((h) => h.key === 'Cache-Control').map((h) => h.value).pop();
  // Vercel's source "/(<regex>)" is a regex on the path.
  const rewrite = new RegExp(`^${vercel.rewrites[0].source}$`);

  it('sends app pages to index.html but never the API, the worker, the manifest or files', () => {
    for (const path of ['/', '/studio/d_1', '/join/ABCD', '/settings']) expect(rewrite.test(path), path).toBe(true);
    for (const path of ['/api/draft-deck', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/assets/index-abc.js', '/samples/nest.svg']) {
      expect(rewrite.test(path), path).toBe(false);
    }
  });

  it('lets browsers check the worker and manifest for every deploy', () => {
    expect(cacheControl('/sw.js')).toBe('no-cache');
    expect(cacheControl('/manifest.webmanifest')).toMatch(/max-age=0/);
    for (const path of ['/sw.js', '/manifest.webmanifest', '/icons/icon-512.png']) expect(cacheControl(path), path).not.toMatch(/immutable/);
    expect(headersFor('/manifest.webmanifest').find((h) => h.key === 'Content-Type')?.value).toMatch(/^application\/manifest\+json/);
  });

  it('keeps hashed build files forever', () => {
    expect(cacheControl('/assets/index-abc.js')).toMatch(/immutable/);
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GET, PictureFetchError, type Resolve, downloadPicture, guardedLookup, isPrivateAddress, parsePictureUrl, sniffImage } from '../api/picture-fetch';

const blocked = (url: string) => {
  try {
    parsePictureUrl(url);
    return false;
  } catch (error) {
    expect(error).toBeInstanceOf(PictureFetchError);
    return true;
  }
};

describe('private addresses', () => {
  it('blocks loopback, private, link-local, CGNAT and multicast IPv4', () => {
    for (const a of ['127.0.0.1', '127.8.9.10', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.0.8']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it('allows public IPv4, and the 198.18/15 fake-IP range proxy tools use', () => {
    for (const a of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '198.18.0.110', '198.19.255.1']) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });

  it('blocks private IPv6, including IPv4 hidden inside it', () => {
    for (const a of ['::1', '::', '[::1]', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a00:1', '2002:7f00:1::', '::127.0.0.1', '0:0:0:0:0:0:0:1', 'fe80::1%eth0']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['2606:4700::6810:84e5', '2a00:1450:4001:80b::200e', '::ffff:93.184.216.34', '64:ff9b::5db8:d822']) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });

  it('treats text that is not an address as unsafe', () => {
    expect(isPrivateAddress('example.com')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
    expect(isPrivateAddress('999.1.1.1')).toBe(true);
  });
});

describe('picture links', () => {
  it('accepts ordinary http and https links on ports 80 and 443', () => {
    expect(parsePictureUrl('https://upload.wikimedia.org/a.jpg').hostname).toBe('upload.wikimedia.org');
    expect(parsePictureUrl('http://example.com:80/a.png').toString()).toBe('http://example.com/a.png');
    expect(parsePictureUrl('https://example.com:443/a.png').toString()).toBe('https://example.com/a.png');
    expect(parsePictureUrl('http://example.com:443/a.png').port).toBe('443');
  });

  it('refuses other schemes, ports, credentials and local names', () => {
    for (const url of [
      'ftp://example.com/a.png', 'file:///etc/passwd', 'data:image/png;base64,AAAA', 'javascript:alert(1)',
      'https://example.com:8443/a.png', 'http://example.com:22/', 'https://user:pass@example.com/a.png', 'https://user@example.com/a.png',
      'http://localhost/a.png', 'http://LOCALHOST./a.png', 'http://app.localhost/a.png', 'http://printer.local/a.png', 'http://metadata.google.internal/',
      'http://intranet/a.png', 'not a url', '',
    ]) expect(blocked(url), url).toBe(true);
  });

  it('refuses private IPs however they are written', () => {
    for (const url of [
      'http://127.0.0.1/a.png', 'http://2130706433/a.png', 'http://0x7f.1/a.png', 'http://0177.0.0.1/', 'http://127.1/',
      'http://[::1]/a.png', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://[fd00::1]/',
    ]) expect(blocked(url), url).toBe(true);
    expect(blocked('http://93.184.216.34/a.png')).toBe(false);
  });
});

describe('the connect-time check', () => {
  const fake = (answers: Record<string, string[]>): Resolve => (host, done) => {
    const list = answers[host];
    if (!list) done(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }), []);
    else done(null, list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  };
  const lookup = guardedLookup(fake({
    'public.example': ['93.184.216.34'],
    'rebind.example': ['10.0.0.5'],
    'mixed.example': ['127.0.0.1', '93.184.216.34', '::1', '2606:4700::1'],
  }));
  const ask = (host: string, options: { all?: boolean } = {}) => new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((done) => {
    lookup(host, options, (error, address) => done({ error, address }));
  });

  it('hands out public addresses', async () => {
    expect(await ask('public.example')).toEqual({ error: null, address: '93.184.216.34' });
  });

  it('refuses a name that resolves only to private addresses (DNS rebinding)', async () => {
    const { error } = await ask('rebind.example');
    expect(error?.code).toBe('EPRIVATE');
  });

  it('only ever dials the public answers of a mixed reply', async () => {
    expect((await ask('mixed.example')).address).toBe('93.184.216.34');
    expect((await ask('mixed.example', { all: true })).address).toEqual([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1', family: 6 }]);
  });

  it('stops a download whose name resolves to a private address, before any request is sent', async () => {
    const rebinding = fake({ 'pictures.example': ['127.0.0.1'] });
    await expect(downloadPicture('http://pictures.example/cat.jpg', rebinding)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('private network') });
  });
});

describe('file types', () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  const ascii = (s: string, ...rest: number[]) => new Uint8Array([...s].map((c) => c.charCodeAt(0)).concat(rest, new Array(8).fill(0)));

  it('trusts the first bytes, not the name', () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImage(ascii('GIF89a'))).toBe('image/gif');
    const webp = ascii('RIFF');
    webp.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    expect(sniffImage(webp)).toBe('image/webp');
    expect(sniffImage(ascii('<!DOCTYPE html><html>'))).toBeNull();
    expect(sniffImage(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('the endpoint', () => {
  it('answers blocked links with a readable error and no network call', async () => {
    const res = await GET(new Request(`http://x/api/picture-fetch?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/private network/);
    const missing = await GET(new Request('http://x/api/picture-fetch'));
    expect(missing.status).toBe(400);
  });
});

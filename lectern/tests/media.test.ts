// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ACTIVITY_CSP, activityDocument, cleanSvg, displayUrl, extractHtml, looksLikeHtml, pageEmbed, svgAspect } from '../src/core/media/embed';
import { QR_TEXT_MAX, qrGifDataUrl, qrImage, qrSvgDataUrl } from '../src/core/media/qr';
import { clock, pickerHtml, timerHtml, timerSeconds } from '../src/core/media/templates';
import { parseTime, parseVideo, videoEmbedUrl, videoThumbnail, videoWatchUrl } from '../src/core/media/video';
import { getTheme } from '../src/core/engine/themes';

describe('video links', () => {
  it('reads times in every common form', () => {
    expect(parseTime('90')).toBe(90);
    expect(parseTime('1:30')).toBe(90);
    expect(parseTime('1:02:03')).toBe(3723);
    expect(parseTime('1m30s')).toBe(90);
    expect(parseTime('1h2m')).toBe(3720);
    expect(parseTime('')).toBe(0);
    expect(parseTime('soon')).toBe(0);
  });

  it('reads YouTube links of every shape, with their start time', () => {
    const id = 'dQw4w9WgXcQ';
    expect(parseVideo(`https://www.youtube.com/watch?v=${id}&t=30`)).toEqual({ provider: 'youtube', id, start: 30 });
    expect(parseVideo(`https://youtu.be/${id}?t=1m5s`)).toEqual({ provider: 'youtube', id, start: 65 });
    expect(parseVideo(`youtube.com/shorts/${id}`)).toEqual({ provider: 'youtube', id, start: 0 });
    expect(parseVideo(`https://m.youtube.com/embed/${id}`)).toEqual({ provider: 'youtube', id, start: 0 });
    expect(parseVideo('https://www.youtube.com/watch?v=short')).toBeNull();
  });

  it('reads Vimeo links, video files and stored videos', () => {
    expect(parseVideo('https://vimeo.com/76979871#t=12')).toEqual({ provider: 'vimeo', id: '76979871', start: 12 });
    expect(parseVideo('https://example.com/clip.mp4')).toEqual({ provider: 'file', src: 'https://example.com/clip.mp4' });
    expect(parseVideo('asset:abc')).toEqual({ provider: 'file', src: 'asset:abc' });
    expect(parseVideo('https://example.com/page')).toBeNull();
    expect(parseVideo('')).toBeNull();
    expect(parseVideo(42)).toBeNull();
  });

  it('builds players, stills and watch links', () => {
    const yt = parseVideo('https://youtu.be/dQw4w9WgXcQ?t=30')!;
    const player = new URL(videoEmbedUrl(yt, { autoplay: true, loop: true, muted: true }));
    expect(player.hostname).toBe('www.youtube-nocookie.com');
    expect(Object.fromEntries(player.searchParams)).toMatchObject({ start: '30', autoplay: '1', mute: '1', loop: '1', playlist: 'dQw4w9WgXcQ' });
    expect(videoEmbedUrl(yt, { start: 5 })).toContain('start=5');
    expect(videoThumbnail(yt)).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(videoWatchUrl(yt)).toBe('https://youtu.be/dQw4w9WgXcQ?t=30');
    const vimeo = parseVideo('https://vimeo.com/76979871')!;
    expect(videoEmbedUrl(vimeo, { start: 10 })).toBe('https://player.vimeo.com/video/76979871?title=0&byline=0&portrait=0#t=10s');
    expect(videoWatchUrl(parseVideo('asset:abc'))).toBe('');
    expect(videoThumbnail(vimeo)).toBe('');
  });
});

describe('web pages', () => {
  it('converts sites that need an embed address', () => {
    expect(pageEmbed('https://docs.google.com/presentation/d/abc123/edit#slide=id.p')).toMatchObject({
      src: 'https://docs.google.com/presentation/d/abc123/embed?start=false&loop=false', site: 'Google Slides',
    });
    expect(pageEmbed('https://docs.google.com/forms/d/e/xyz/viewform')?.src).toBe('https://docs.google.com/forms/d/e/xyz/viewform?embedded=true');
    expect(pageEmbed('https://docs.google.com/document/d/abc/edit')?.src).toBe('https://docs.google.com/document/d/abc/preview');
    expect(pageEmbed('https://www.figma.com/design/KEY/Name')?.src).toContain('figma.com/embed?embed_host=lectern&url=');
    expect(pageEmbed('https://www.geogebra.org/m/abcd1234')?.src).toBe('https://www.geogebra.org/material/iframe/id/abcd1234');
    expect(pageEmbed('https://codepen.io/someone/pen/xyz')?.src).toBe('https://codepen.io/someone/embed/xyz?default-tab=result');
  });

  it('keeps the original address to open, and passes other sites through', () => {
    const page = pageEmbed('example.com/a/b')!;
    expect(page).toEqual({ src: 'https://example.com/a/b', open: 'https://example.com/a/b', site: 'example.com' });
    expect(pageEmbed('https://docs.google.com/presentation/d/abc/edit')?.open).toBe('https://docs.google.com/presentation/d/abc/edit');
    expect(pageEmbed('')).toBeNull();
    expect(pageEmbed('not a url at all')).toBeNull();
  });

  it('shortens addresses for slides', () => {
    expect(displayUrl('https://www.example.com/')).toBe('example.com');
    expect(displayUrl('https://example.com/join/')).toBe('example.com/join');
    expect(displayUrl(`https://example.com/${'x'.repeat(80)}`)).toHaveLength(47);
  });
});

describe('activities', () => {
  it('puts the no-network policy first in the head, whatever shape the HTML has', () => {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${ACTIVITY_CSP}">`;
    expect(activityDocument('<!doctype html><html><head><title>x</title></head><body></body></html>')).toContain(`<head>${meta}<title>`);
    expect(activityDocument('<html lang="en"><body>hi</body></html>')).toContain(`<html lang="en"><head>${meta}</head>`);
    expect(activityDocument('<div>hi</div>')).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"[^>]*><meta charset="utf-8"><\/head><body><div>hi<\/div>/);
    expect(ACTIVITY_CSP).toContain("connect-src 'none'");
  });

  it('pulls the document out of AI chatter and code fences', () => {
    const doc = '<!doctype html><html><body>game</body></html>';
    expect(extractHtml(`Here you go:\n\`\`\`html\n${doc}\n\`\`\`\nEnjoy!`)).toBe(doc);
    expect(extractHtml(`Sure! ${doc} Have fun.`)).toBe(doc);
    expect(looksLikeHtml('<canvas id="c"></canvas>')).toBe(true);
    expect(looksLikeHtml('just words')).toBe(false);
  });

  it('builds timer and picker pages that are safe inside a script element', () => {
    const theme = getTheme('paper');
    const picker = pickerHtml(theme, { items: ['</script><script>alert(1)</script>', 'Line\u2028break'], removePicked: true });
    expect(picker).not.toContain('</script><script>alert(1)');
    expect(picker).not.toContain('\u2028');
    expect(picker).toContain('\\u003c/script>');
    const timer = timerHtml(theme, { seconds: 150, autostart: true, sound: false });
    expect(timer).toContain('<!doctype html>');
    expect(timerSeconds('2:30')).toBe(150);
    expect(timerSeconds('5')).toBe(300);
    expect(clock(150)).toBe('2:30');
  });
});

describe('SVG drawings', () => {
  it('removes scripts, handlers, embedded HTML and outside references', () => {
    const raw = '```svg\n<svg viewBox="0 0 200 100" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject>'
      + '<image href="https://evil.example/x.png"/><rect fill="url(https://evil.example/p)" onclick=\'go()\'/><use href="#a"/></svg>\n```';
    const svg = cleanSvg(raw)!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox/);
    expect(svg).not.toMatch(/script|onload|onclick|foreignObject|evil\.example/i);
    expect(svg).toContain('href="#a"');
    expect(svgAspect(svg)).toBe(2);
  });

  it('keeps embedded pictures and rejects text that is not SVG', () => {
    expect(cleanSvg('<svg width="40" height="20"><image href="data:image/png;base64,AAAA"/></svg>')).toContain('data:image/png;base64,AAAA');
    expect(svgAspect('<svg width="40" height="20"></svg>')).toBe(2);
    expect(cleanSvg('<div>no</div>')).toBeNull();
  });
});

describe('QR codes', () => {
  it('makes an SVG for screens and a GIF for PowerPoint', () => {
    expect(qrSvgDataUrl('https://example.com')).toMatch(/^data:image\/svg\+xml/);
    expect(qrGifDataUrl('https://example.com')).toMatch(/^data:image\/gif;base64,R0lGOD/);
    expect(qrImage('https://example.com', 'pptx')).toMatch(/^data:image\/gif/);
    expect(qrImage('https://example.com', 'web')).toMatch(/^data:image\/svg/);
  });

  it('encodes non-Latin text as UTF-8', () => {
    expect(() => qrGifDataUrl('Grüße, 你好 👋')).not.toThrow();
    expect(QR_TEXT_MAX).toBeGreaterThan(500);
  });
});

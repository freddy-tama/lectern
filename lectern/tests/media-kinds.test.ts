// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type EmbedBox, type ImageBox, type VideoBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { MEDIA_KINDS } from '../src/core/kinds/media-kinds';
import { getKind } from '../src/core/kinds/registry';

registerCoreKinds();

const ACTIVITY = '<!doctype html><html><head></head><body><button>Go</button></body></html>';

const FILLED: Record<string, Record<string, unknown>> = {
  video: { title: 'Watch this', video: 'https://youtu.be/dQw4w9WgXcQ?t=30', body: 'Look for the turn.', caption: 'Credit: someone', start: '', autoplay: false, muted: false, loop: false },
  web: { title: 'Our slides', url: 'https://docs.google.com/presentation/d/abc123/edit', qr: true, caption: 'Open on your laptop' },
  qr: { title: 'Scan to join in', url: 'https://example.com/join', body: 'You get the worksheet.', showLink: true },
  activity: { title: 'Sort them', prompt: 'A sorting game', html: ACTIVITY, caption: 'Drag each card' },
  timer: { title: 'Talk it over', minutes: '2:30', autostart: false, sound: true },
  picker: { title: 'Who goes first?', items: ['Ana', 'Ben', 'Cy'], removePicked: true },
  cards: { title: 'Why it works', cards: [1, 2, 3, 4, 5].map((i) => ({ icon: '⚡', heading: `Reason ${i}`, text: 'A short line.' })), reveal: true },
};

const slideOf = (kind: string, content: Record<string, unknown>, variant?: string): Slide => ({ id: `s-${kind}`, kind, content, variant, notes: emptyNotes() });

function lay(kind: string, content: Record<string, unknown>, o: { variant?: string; target?: 'web' | 'pptx'; mode?: 'edit' | 'show' } = {}) {
  return layoutSlide(slideOf(kind, content, o.variant), { theme: getTheme('paper'), audience: 'adult', mode: o.mode ?? 'show', target: o.target });
}

function inside(boxes: Box[]) {
  for (const b of boxes) {
    if (b.id.startsWith('deco')) continue;
    expect(b.x, `${b.id} x`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${b.id} y`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `${b.id} right`).toBeLessThanOrEqual(CANVAS_W + 1);
    expect(b.y + b.h, `${b.id} bottom`).toBeLessThanOrEqual(CANVAS_H + 1);
  }
}

const ofType = <T extends Box>(boxes: Box[], type: T['type']) => boxes.filter((b): b is T => b.type === type);

describe('media slide types', () => {
  it('registers each one with a filled example', () => {
    for (const def of MEDIA_KINDS) {
      expect(getKind(def.kind), def.kind).toBe(def);
      expect(FILLED[def.kind], `no example for ${def.kind}`).toBeTruthy();
    }
  });

  it('lays out every layout inside the slide, new or filled, editing or showing, on screen or in PowerPoint', () => {
    for (const def of MEDIA_KINDS) {
      for (const variant of def.variants?.map((v) => v.id) ?? [undefined]) {
        for (const content of [def.create(), FILLED[def.kind]]) {
          for (const mode of ['edit', 'show'] as const) {
            for (const target of ['web', 'pptx'] as const) {
              const { boxes } = lay(def.kind, content, { variant, mode, target });
              expect(boxes.length, `${def.kind}/${variant} ${mode} ${target}`).toBeGreaterThan(0);
              inside(boxes);
            }
          }
        }
      }
    }
  });

  it('plays YouTube from its start time, in every layout', () => {
    for (const variant of ['stage', 'side', 'full']) {
      const [video] = ofType<VideoBox>(lay('video', FILLED.video, { variant }).boxes, 'video');
      expect(video?.src, variant).toBe(FILLED.video.video);
    }
  });

  it('frames web pages at their embed address and adds a QR code when asked', () => {
    const { boxes } = lay('web', FILLED.web, { variant: 'stage' });
    const [embed] = ofType<EmbedBox>(boxes, 'embed');
    expect(embed.url).toBe('https://docs.google.com/presentation/d/abc123/embed?start=false&loop=false');
    expect(embed.openUrl).toBe(FILLED.web.url);
    expect(ofType<ImageBox>(boxes, 'image').some((b) => b.src.startsWith('data:image/svg+xml'))).toBe(true);
  });

  it('draws QR codes as SVG on screen and GIF in PowerPoint', () => {
    const web = ofType<ImageBox>(lay('qr', FILLED.qr).boxes, 'image');
    const pptx = ofType<ImageBox>(lay('qr', FILLED.qr, { target: 'pptx' }).boxes, 'image');
    expect(web[0].src).toMatch(/^data:image\/svg\+xml/);
    expect(pptx[0].src).toMatch(/^data:image\/gif/);
  });

  it('runs activities and timers as pages on screen, and gives PowerPoint something it can show', () => {
    const [game] = ofType<EmbedBox>(lay('activity', FILLED.activity).boxes, 'embed');
    expect(game.html).toBe(ACTIVITY);
    const [clock] = ofType<EmbedBox>(lay('timer', FILLED.timer).boxes, 'embed');
    expect(clock.html).toContain('<!doctype html>');
    const pptxTimer = lay('timer', FILLED.timer, { target: 'pptx' }).boxes;
    expect(ofType(pptxTimer, 'embed')).toHaveLength(0);
    expect(pptxTimer.some((b) => b.type === 'text' && b.text === '2:30')).toBe(true);
    const pptxPicker = lay('picker', FILLED.picker, { target: 'pptx' }).boxes;
    expect(ofType(pptxPicker, 'embed')).toHaveLength(0);
    expect(pptxPicker.some((b) => b.type === 'text' && b.text.includes('Ben'))).toBe(true);
  });

  it('shows a placeholder for an activity that is not built yet, only while editing', () => {
    const empty = { title: '', prompt: 'A quiz', html: '', caption: '' };
    const edit = lay('activity', empty, { mode: 'edit' }).boxes;
    expect(edit.some((b) => b.type === 'text' && /Build/.test(b.text))).toBe(true);
    const show = lay('activity', empty, { mode: 'show' }).boxes;
    expect(show.some((b) => b.type === 'text' && /Build/.test(b.text))).toBe(false);
  });

  it('lays out cards in a row or a grid', () => {
    const row = lay('cards', FILLED.cards, { variant: 'row' }).boxes.filter((b) => b.bind?.endsWith('.heading'));
    const grid = lay('cards', FILLED.cards, { variant: 'grid' }).boxes.filter((b) => b.bind?.endsWith('.heading'));
    expect(row).toHaveLength(5);
    expect(new Set(row.map((b) => b.y)).size).toBe(1);
    expect(new Set(grid.map((b) => b.y)).size).toBe(2);
  });
});

describe('media in PowerPoint', () => {
  const deck: Deck = {
    id: 'd1', title: 'Media', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0,
    slides: [
      slideOf('video', FILLED.video, 'stage'),
      slideOf('video', { ...FILLED.video, video: 'asset:clip' }, 'stage'),
      slideOf('web', FILLED.web, 'stage'),
      slideOf('activity', FILLED.activity, 'stage'),
      slideOf('qr', FILLED.qr),
      slideOf('timer', FILLED.timer),
    ].map((s, i) => ({ ...s, id: `s${i}` })),
  };

  it('embeds YouTube as an online video and stored files as video files, with links for everything else', async () => {
    const tinyMp4 = `data:video/mp4;base64,${Buffer.from('not really a video').toString('base64')}`;
    const result = await exportDeckToPptx(deck, { output: 'nodebuffer', resolveMedia: async (src) => (src === 'asset:clip' ? tinyMp4 : null) });
    const zip = await JSZip.loadAsync(result.data as Uint8Array);
    const xml = async (path: string) => zip.file(path)!.async('string');
    const rels = await Promise.all(Object.keys(zip.files).filter((p) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(p)).map(xml));
    expect(rels.join('\n')).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ?start=30');
    expect(Object.keys(zip.files).some((p) => /^ppt\/media\/.*\.mp4$/.test(p))).toBe(true);
    const slides = await Promise.all(Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).map(xml));
    const all = slides.join('\n');
    expect(all).toContain('docs.google.com/presentation/d/abc123/edit');
    expect(all).toContain('An interactive activity');
    expect(all).toContain('2:30');
    expect(result.warnings.filter((w) => /image was left out/.test(w))).toEqual([]);
  });

  it('warns when a stored video cannot be included', async () => {
    const result = await exportDeckToPptx(deck, { output: 'nodebuffer', resolveMedia: async () => null });
    expect(result.warnings.some((w) => /stored video/.test(w))).toBe(true);
  });
});

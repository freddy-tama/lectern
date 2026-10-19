// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSlide } from '../src/core/deck/draft';
import type { Audience } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type ImageBox, type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { THEMES, type Theme, allThemes, getTheme, registerTheme, unregisterTheme } from '../src/core/engine/themes';
import { CORE_KINDS } from '../src/core/kinds/core-kinds';
import { M } from '../src/core/kinds/kit';
import { db } from '../src/data/db';
import { copyLook, deleteLook, loadLooks, saveLook } from '../src/data/looks';
import { PALETTES, contrastIssues, deriveColors } from '../src/features/looks/catalog';
import { contrast } from '../src/features/looks/color';

const AUDIENCES: Audience[] = ['young', 'teen', 'adult'];

function brand(patch: Partial<Theme> = {}): Theme {
  return {
    ...copyLook(getTheme('campus'), 'Northwind'),
    id: 'look_test',
    colors: deriveColors(PALETTES[0].colors),
    display: { web: 'Georgia, serif', pptx: 'Georgia', weight: 700 },
    body: { web: 'Arial, sans-serif', pptx: 'Arial', weight: 400 },
    logo: 'data:image/png;base64,iVBORw0KGgo=',
    logoAspect: 3,
    logoPosition: 'bottom-left',
    footerText: 'Northwind · Internal',
    ...patch,
  };
}

function lay(theme: Theme, kind = 'bullets', audience: Audience = 'adult', target: 'web' | 'pptx' = 'web') {
  return layoutSlide(makeSlide(kind), { theme, audience, slideNumber: 2, slideCount: 5, target });
}

beforeEach(() => {
  unregisterTheme('look_test');
});

describe('custom looks', () => {
  it('apply their colours and fonts to slide layouts', () => {
    registerTheme(brand());
    const theme = getTheme('look_test');
    expect(theme.name).toBe('Northwind');
    const out = lay(theme);
    expect(out.background).toBe(PALETTES[0].colors.bg);
    const title = out.boxes.find((b): b is TextBox => b.id === 'title' && b.type === 'text')!;
    expect(title.style.color).toBe(PALETTES[0].colors.ink);
    expect(title.style.weight).toBe(700);
    expect(out.boxes.some((b) => b.type === 'shape' && b.fill === PALETTES[0].colors.accent)).toBe(true);
  });

  it('put the logo in the chosen corner and the footer text at the foot', () => {
    for (const pos of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const out = lay(brand({ logoPosition: pos }));
      const logo = out.boxes.find((b): b is ImageBox => b.id === 'logo')!;
      expect(logo.type).toBe('image');
      expect(logo.bind).toBeUndefined();
      expect(logo.w).toBeCloseTo(logo.h * 3, 0);
      if (pos.endsWith('left')) expect(logo.x).toBe(M.x);
      else expect(logo.x + logo.w).toBe(M.right);
      if (pos.startsWith('top')) expect(logo.y + logo.h).toBeLessThanOrEqual(M.top);
      else expect(logo.y).toBeGreaterThanOrEqual(M.bottom);
      expect(logo.x).toBeGreaterThanOrEqual(0);
      expect(logo.y + logo.h).toBeLessThanOrEqual(CANVAS_H);
      expect(logo.x + logo.w).toBeLessThanOrEqual(CANVAS_W);

      const foot = out.boxes.find((b): b is TextBox => b.id === 'footer')!;
      const page = out.boxes.find((b): b is TextBox => b.id === 'page')!;
      expect(foot.text).toBe('Northwind · Internal');
      expect(page.text).toBe('2');
      const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlaps(foot, logo)).toBe(false);
      expect(overlaps(page, logo)).toBe(false);
      expect(overlaps(foot, page)).toBe(false);
    }
  });

  it('show the logo on title slides but not on section dividers', () => {
    const theme = brand({ logoPosition: 'top-right' });
    expect(lay(theme, 'title').boxes.some((b) => b.id === 'logo')).toBe(true);
    expect(lay(theme, 'section').boxes.some((b) => b.id === 'logo')).toBe(false);
  });

  it('resolve the logo through the host for export', () => {
    const theme = brand({ logo: 'asset:abc' });
    const out = layoutSlide(makeSlide('bullets'), { theme, audience: 'adult', slideCount: 3, resolveImage: (s) => s.replace('asset:', 'blob:') });
    expect((out.boxes.find((b) => b.id === 'logo') as ImageBox).src).toBe('blob:abc');
  });

  it('add no warnings to any core slide', () => {
    const theme = brand();
    for (const kind of CORE_KINDS) {
      for (const audience of AUDIENCES) {
        const slide = makeSlide(kind.kind);
        const base = layoutSlide(slide, { theme: getTheme('campus'), audience, slideNumber: 3, slideCount: 8 });
        const out = layoutSlide(slide, { theme, audience, slideNumber: 3, slideCount: 8 });
        expect(out.warnings.filter((w) => !base.warnings.includes(w)), `${kind.kind} ${audience}`).toEqual([]);
      }
    }
  });

  it('can be replaced and removed, falling back to the default look', () => {
    registerTheme(brand());
    registerTheme(brand({ name: 'Northwind 2' }));
    expect(allThemes().filter((t) => t.id === 'look_test')).toHaveLength(1);
    expect(getTheme('look_test').name).toBe('Northwind 2');
    unregisterTheme('look_test');
    expect(getTheme('look_test').id).toBe(THEMES[0].id);
  });

  it('never replace a built-in look', () => {
    registerTheme({ ...brand(), id: 'paper', name: 'Hijack' });
    expect(getTheme('paper').name).toBe('Paper');
  });

  it('leave the built-in looks without logo or footer', () => {
    const out = lay(getTheme('paper'));
    expect(out.boxes.some((b) => b.id === 'logo' || b.id === 'footer')).toBe(false);
  });
});

describe('look colours', () => {
  it('pick readable text for the accent and flag low contrast', () => {
    for (const p of PALETTES) {
      const c = deriveColors(p.colors);
      expect(contrast(c.onAccent, c.accent), p.id).toBeGreaterThanOrEqual(4.5);
      expect(contrastIssues({ ...THEMES[0], colors: c }), p.id).toEqual([]);
    }
    const weak = { ...THEMES[0], colors: deriveColors({ ...PALETTES[0].colors, ink: '#BBBBBB' }) };
    expect(contrastIssues(weak).map((x) => x.label)).toContain('Text on the background');
  });
});

describe('saved looks', () => {
  it('round-trip through the settings table', async () => {
    await db.settings.delete('looks');
    const saved = await saveLook(brand());
    expect(saved.custom).toBe(true);
    unregisterTheme('look_test');
    expect(getTheme('look_test').id).toBe(THEMES[0].id);

    const loaded = await loadLooks();
    expect(loaded.map((t) => t.id)).toEqual(['look_test']);
    const theme = getTheme('look_test');
    expect(theme.name).toBe('Northwind');
    expect(theme.footerText).toBe('Northwind · Internal');
    expect(theme.logoPosition).toBe('bottom-left');
    expect(theme.colors.accent).toBe(PALETTES[0].colors.accent);

    await saveLook({ ...theme, name: 'Renamed' });
    expect(getTheme('look_test').name).toBe('Renamed');
    expect((await db.settings.get('looks'))?.value).toHaveLength(1);

    await deleteLook('look_test');
    expect(getTheme('look_test').id).toBe(THEMES[0].id);
    expect(await loadLooks()).toEqual([]);
  });

  it('ignore broken entries', async () => {
    await db.settings.put({ key: 'looks', value: [null, { id: 'paper' }, { id: 'look_x', colors: { bg: '#000000' } }] });
    const loaded = await loadLooks();
    expect(loaded.map((t) => t.id)).toEqual(['look_x']);
    expect(loaded[0].colors.bg).toBe('#000000');
    expect(loaded[0].colors.ink).toBe(THEMES[0].colors.ink);
    unregisterTheme('look_x');
  });
});

// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { cjkLang, isCjkFont, tagCjkChart, tagCjkRuns } from '../src/core/export/cjk';
import { exportDeckToPptx } from '../src/core/export/pptx';

const slide = (id: string, kind: string, content: Record<string, unknown>): Slide => ({ id, kind, content, notes: emptyNotes({}) });
const deckOf = (slides: Slide[]): Deck => ({ id: 'd', title: 'Deck', themeId: 'paper', audience: 'teen', createdAt: 0, updatedAt: 0, slides });

async function files(deck: Deck, pattern: RegExp): Promise<string> {
  const { data } = await exportDeckToPptx(deck, { output: 'nodebuffer' });
  const zip = await JSZip.loadAsync(data as Uint8Array);
  const names = Object.keys(zip.files).filter((p) => pattern.test(p)).sort();
  return (await Promise.all(names.map((n) => zip.file(n)!.async('string')))).join('\n');
}
const slideXml = (deck: Deck) => files(deck, /^ppt\/slides\/slide\d+\.xml$/);

/** The run properties that sit directly before a piece of text. */
function runProps(xml: string, text: string): string {
  const m = new RegExp(`<a:rPr\\b[^>]*?(?:/>|>(?:(?!</a:rPr>)[\\s\\S])*</a:rPr>)<a:t>${text}</a:t>`).exec(xml);
  expect(m, `no run for ${text}`).not.toBeNull();
  return m![0];
}

describe('script detection', () => {
  it('names the language of CJK text', () => {
    expect(cjkLang('水的循环')).toBe('zh-CN');
    expect(cjkLang('水の循環です')).toBe('ja-JP');
    expect(cjkLang('漢字とカタカナ')).toBe('ja-JP');
    expect(cjkLang('물의 순환')).toBe('ko-KR');
    expect(cjkLang('Water cycle 123')).toBeNull();
  });

  it('knows which fonts already carry CJK glyphs', () => {
    for (const f of ['Microsoft YaHei', 'SimSun', 'KaiTi', 'Yu Gothic', 'Malgun Gothic', '宋体']) expect(isCjkFont(f), f).toBe(true);
    for (const f of ['Segoe UI', 'Georgia', 'Consolas']) expect(isCjkFont(f), f).toBe(false);
  });
});

describe('CJK text in the PowerPoint export', () => {
  it('gives a Chinese title and bullet their language and a Chinese font, and keeps the Latin font', async () => {
    const xml = await slideXml(deckOf([slide('s1', 'bullets', { title: '水的循环', bullets: ['蒸发和凝结', 'Plain bullet'], reveal: false, image: '' })]));
    const title = runProps(xml, '水的循环');
    expect(title).toContain('lang="zh-CN"');
    expect(title).toContain('<a:ea typeface="Microsoft YaHei"');
    expect(title).toContain('<a:latin typeface="Georgia"');
    const bullet = runProps(xml, '蒸发和凝结');
    expect(bullet).toContain('lang="zh-CN"');
    expect(bullet).toContain('<a:ea typeface="Microsoft YaHei"');
    expect(bullet).toContain('<a:latin typeface="Segoe UI"');
    // The Latin bullet next to it is left as pptxgenjs wrote it.
    const plain = runProps(xml, 'Plain bullet');
    expect(plain).toContain('lang="en-US"');
    expect(plain).toContain('<a:ea typeface="Segoe UI"');
  });

  it('marks Japanese and Korean text with their own language and font', async () => {
    const xml = await slideXml(deckOf([slide('s1', 'bullets', { title: '水の循環', bullets: ['물의 순환'], reveal: false, image: '' })]));
    const ja = runProps(xml, '水の循環');
    expect(ja).toContain('lang="ja-JP"');
    expect(ja).toContain('<a:ea typeface="Yu Gothic"');
    const ko = runProps(xml, '물의 순환');
    expect(ko).toContain('lang="ko-KR"');
    expect(ko).toContain('<a:ea typeface="Malgun Gothic"');
    expect(ko).toContain('<a:latin typeface="Segoe UI"');
  });

  it('tags the cells of a table', async () => {
    const xml = await slideXml(deckOf([slide('s1', 'table', { title: 'Words', cells: '名称\tName\n水\tWater', header: true })]));
    const cell = runProps(xml, '水');
    expect(cell).toContain('lang="zh-CN"');
    expect(cell).toContain('<a:ea typeface="Microsoft YaHei"');
    expect(cell).toContain('<a:latin typeface="Segoe UI"');
    expect(runProps(xml, 'Water')).toContain('lang="en-US"');
  });

  it('keeps a box font that already has Chinese glyphs', () => {
    const run = '<a:r><a:rPr lang="en-US" sz="2000" dirty="0"><a:latin typeface="KaiTi" pitchFamily="34" charset="0"/><a:ea typeface="KaiTi" pitchFamily="34" charset="-122"/></a:rPr><a:t>你好</a:t></a:r>';
    const out = tagCjkRuns(run);
    expect(out).toContain('lang="zh-CN"');
    expect(out).toContain('<a:ea typeface="KaiTi" pitchFamily="34" charset="-122"/>');
  });

  it('gives a chart with Chinese labels an East Asian font', async () => {
    const deck = deckOf([slide('s1', 'chart', { title: 'Sales', rows: [{ label: '苹果', value: '3' }, { label: '梨', value: '5' }], series: 'Count' })]);
    const xml = await files(deck, /^ppt\/charts\/chart\d+\.xml$/);
    expect(xml).toContain('<a:ea typeface="Microsoft YaHei"/>');
    expect(xml).toContain('<a:latin typeface="Segoe UI"/>');
  });

  it('leaves a chart with Latin labels alone', () => {
    const xml = '<c:chartSpace><c:v>Apples</c:v><a:latin typeface="Segoe UI"/></c:chartSpace>';
    expect(tagCjkChart(xml)).toBe(xml);
  });

  it('writes no language or East Asian font for a Latin-only deck', async () => {
    const deck = deckOf([
      slide('s1', 'bullets', { title: 'The water cycle', bullets: ['Evaporation', 'Condensation'], reveal: false, image: '' }),
      slide('s2', 'table', { title: 'Words', cells: 'Name\tUse\nWater\tDrink', header: true }),
    ]);
    const xml = await slideXml(deck);
    expect(xml).not.toContain('lang="zh');
    expect(xml).not.toContain('lang="ja');
    expect(xml).not.toContain('lang="ko');
    expect(xml).not.toContain('altLang');
    expect(xml).not.toContain('Microsoft YaHei');
    expect(tagCjkRuns(xml)).toBe(xml);
  });
});

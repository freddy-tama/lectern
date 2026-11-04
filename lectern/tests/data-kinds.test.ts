// @vitest-environment node
import JSZip from 'jszip';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { outlineToDraft } from '../src/core/deck/outline';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type ChartBox, type TableBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { THEMES, getTheme } from '../src/core/engine/themes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { formatChartValue, namedLabel, niceAxis, parseTable, toNumber } from '../src/core/kinds/data-kinds';
import { getKind, registerKind } from '../src/core/kinds/registry';
import { ChartView } from '../src/features/slides/ChartView';
import { TableView } from '../src/features/slides/TableView';

const slide = (id: string, kind: string, content: Record<string, unknown>, variant?: string): Slide => ({
  id, kind, content, variant, notes: emptyNotes({}),
});

describe('data kinds', () => {
  for (const id of ['chart', 'table']) {
    it(`lays out ${id} with no warnings in every theme, audience and layout`, () => {
      const kind = getKind(id)!;
      expect(kind.group).toBe('Data');
      const variants = kind.variants?.map((v) => v.id) ?? [undefined];
      for (const theme of THEMES) for (const audience of ['young', 'teen', 'adult'] as const) for (const variant of variants) for (const target of ['web', 'pptx'] as const) {
        const label = `${id} ${variant ?? ''} ${theme.id} ${audience} ${target}`;
        const layout = layoutSlide(slide('s1', id, kind.create(), variant), { theme, audience, mode: 'edit', target, slideCount: 3, slideNumber: 2 });
        expect(layout.warnings, label).toEqual([]);
        const data = layout.boxes.find((b) => b.type === 'chart' || b.type === 'table');
        expect(data, label).toBeTruthy();
        for (const b of layout.boxes) {
          if (b.id.startsWith('deco')) continue;
          expect(b.x, `${label} ${b.id}`).toBeGreaterThanOrEqual(0);
          expect(b.y, `${label} ${b.id}`).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w, `${label} ${b.id}`).toBeLessThanOrEqual(CANVAS_W);
          expect(b.y + b.h, `${label} ${b.id}`).toBeLessThanOrEqual(CANVAS_H);
        }
      }
    });
  }

  it('reads messy numbers and skips empty rows', () => {
    expect(toNumber('$1,200')).toBe(1200);
    expect(toNumber('12.5%')).toBe(12.5);
    expect(toNumber('-3')).toBe(-3);
    expect(toNumber('(40)')).toBe(-40);
    expect(toNumber('n/a')).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    const content = { ...getKind('chart')!.create(), rows: [{ label: 'A', value: 'lots', value2: '' }, { label: '', value: '', value2: '' }, { label: 'B', value: '7', value2: '' }] };
    const layout = layoutSlide(slide('s1', 'chart', content), { theme: getTheme('paper'), audience: 'adult' });
    const chart = layout.boxes.find((b): b is ChartBox => b.type === 'chart')!;
    expect(chart.labels).toEqual(['A', 'B']);
    expect(chart.series).toHaveLength(1);
    expect(chart.series[0].values).toEqual([0, 7]);
    expect(chart.showLegend).toBe(false);
  });

  it('formats values and picks round axes', () => {
    expect(formatChartValue(1200, '$', 'before')).toBe('$1,200');
    expect(formatChartValue(-5, '$', 'before')).toBe('-$5');
    expect(formatChartValue(12.5, '%', 'after', 1)).toBe('12.5%');
    expect(formatChartValue(3, 'kg')).toBe('3 kg');
    expect(niceAxis(0, 78)).toEqual({ min: 0, max: 80, step: 20 });
    expect(niceAxis(-12, 30)).toEqual({ min: -20, max: 30, step: 10 });
  });

  it('parses pasted cells', () => {
    expect(parseTable('a\tb\n1\t2').rows).toEqual([['a', 'b'], ['1', '2']]);
    const md = parseTable('| Name | Score |\n|:---|---:|\n| Ann | 9 |\n| Bo |');
    expect(md.rows).toEqual([['Name', 'Score'], ['Ann', '9'], ['Bo', '']]);
    expect(md.align).toEqual(['left', 'right']);
  });

  it('right-aligns numeric columns and warns when a table is too big', () => {
    const layout = layoutSlide(slide('s1', 'table', getKind('table')!.create()), { theme: getTheme('campus'), audience: 'adult' });
    const table = layout.boxes.find((b): b is TableBox => b.type === 'table')!;
    expect(table.align).toEqual(['left', 'right', 'right']);
    expect(table.colWidths.reduce((a, b) => a + b, 0)).toBe(table.w);
    expect(table.rowHeights.reduce((a, b) => a + b, 0)).toBe(table.h);
    const big = Array.from({ length: 30 }, (_, i) => `Row ${i} | some longer text in this cell | ${i * 10}`).join('\n');
    const over = layoutSlide(slide('s2', 'table', { title: 'Too much', cells: big, header: true, stripes: true, caption: '' }), { theme: getTheme('campus'), audience: 'adult' });
    expect(over.warnings.join(' ')).toContain('too big for one slide');
  });

  it('keeps what the takeaway names in colour and turns the rest grey', () => {
    const theme = getTheme('paper');
    const chartOf = (content: Record<string, unknown>, variant: string) => layoutSlide(slide('s1', 'chart', content, variant), { theme, audience: 'adult' }).boxes.find((b) => b.type === 'chart') as ChartBox;
    const rows = [{ label: 'North', value: '12' }, { label: 'South', value: '30' }, { label: 'East', value: '9' }];
    const one = { title: 'Sales by region', rows, takeaway: 'The South sold most.' };
    const cols = chartOf(one, 'column');
    expect(cols.pointColors?.[1]).toBe(theme.colors.accent);
    expect(cols.pointColors?.[0]).toBe(cols.pointColors?.[2]);
    expect(cols.pointColors?.[0]).not.toBe(theme.colors.accent);
    const pie = chartOf(one, 'pie');
    expect(pie.colors[1]).toBe(theme.colors.accent);
    expect(pie.colors[0]).toBe(theme.colors.muted);
    // Two series: the first in colour, the comparison grey.
    const two = chartOf(getKind('chart')!.create(), 'column');
    expect(two.colors[0]).toBe(theme.colors.accent);
    expect(two.colors[1]).not.toBe(theme.colors.accent);
    expect(two.pointColors).toBeUndefined();
    // Nothing named once, no takeaway, the toggle off, or a line: every bar in colour.
    expect(chartOf({ ...one, takeaway: 'North and South lead.' }, 'column').pointColors).toBeUndefined();
    expect(chartOf({ ...one, takeaway: 'Southern regions lead.' }, 'column').pointColors).toBeUndefined();
    expect(chartOf({ ...one, takeaway: '' }, 'column').pointColors).toBeUndefined();
    expect(chartOf({ ...one, highlight: false }, 'column').pointColors).toBeUndefined();
    expect(chartOf(one, 'line').pointColors).toBeUndefined();
    expect(namedLabel('华南地区最高', ['华北', '华南'])).toBe(1);
  });

  it('puts a source line under charts and big numbers, above the footer', () => {
    const source = 'Source: annual survey, 2025';
    const cases: [string, Record<string, unknown>, string | undefined, string][] = [
      ...['column', 'bar', 'line', 'pie'].map((v) => ['chart', { ...getKind('chart')!.create(), source }, v, 'chart'] as [string, Record<string, unknown>, string, string]),
      ['stats', { ...getKind('stats')!.create(), source }, 'row', 'v1'],
      ['stats', { title: 'Replies got faster', stats: [{ value: '42%', label: 'faster replies', detail: '' }], source }, 'hero', 'v0'],
    ];
    for (const [kind, content, variant, above] of cases) {
      const label = `${kind} ${variant}`;
      const layout = layoutSlide(slide('s1', kind, content, variant), { theme: getTheme('campus'), audience: 'adult', mode: 'edit', slideCount: 3, slideNumber: 2 });
      expect(layout.warnings, label).toEqual([]);
      const src = layout.boxes.find((b) => b.id === 'source')!;
      expect(src, label).toBeTruthy();
      expect(src.y + src.h, label).toBeLessThanOrEqual(CANVAS_H - 96);
      for (const id of [above, 'takeaway']) {
        const b = layout.boxes.find((x) => x.id === id || (id === 'chart' && x.type === 'chart'));
        if (b) expect(b.y + b.h, `${label} ${id}`).toBeLessThanOrEqual(src.y);
      }
      expect(getKind(kind)!.text(content)).toContain(source);
    }
    const none = layoutSlide(slide('s1', 'chart', getKind('chart')!.create()), { theme: getTheme('campus'), audience: 'adult' });
    expect(none.boxes.some((b) => b.id === 'source')).toBe(false);
  });

  it('asks report and pitch drafts for titles that state the finding, and sources', async () => {
    const { wording } = await import('../src/core/deck/purpose');
    for (const purpose of ['report', 'pitch'] as const) {
      expect(wording(purpose).aiRules, purpose).toMatch(/title states the (finding|slide's claim)/);
      expect(wording(purpose).aiRules, purpose).toMatch(/source/);
    }
  });
});

describe('screen renderers', () => {
  it('draw every chart layout and the table', () => {
    const theme = getTheme('sunny');
    const kind = getKind('chart')!;
    const marks: Record<string, RegExp> = { column: /<rect/g, bar: /<rect/g, line: /<circle/g, pie: /<path/g, doughnut: /<path/g };
    for (const v of kind.variants!) {
      const layout = layoutSlide(slide('s', 'chart', kind.create(), v.id), { theme, audience: 'teen' });
      const box = layout.boxes.find((b): b is ChartBox => b.type === 'chart')!;
      const html = renderToStaticMarkup(createElement(ChartView, { box, theme }));
      expect(html, v.id).toContain('<svg');
      expect(html, v.id).toContain('$78');
      expect((html.match(marks[v.id]) ?? []).length, v.id).toBeGreaterThanOrEqual(4);
      expect(html, v.id).not.toContain('NaN');
    }
    const layout = layoutSlide(slide('t', 'table', getKind('table')!.create()), { theme, audience: 'teen' });
    const box = layout.boxes.find((b): b is TableBox => b.type === 'table')!;
    const html = renderToStaticMarkup(createElement(TableView, { box, theme }));
    expect(html.match(/class="table-cell"/g)).toHaveLength(12);
    expect(html).toContain('Business');
  });
});

describe('outline tables', () => {
  it('turns a pipe table into a table slide titled by its section', () => {
    const draft = outlineToDraft([
      '# Results',
      '',
      '## Pilot results',
      '| Site | Users | Growth |',
      '|------|------:|--------|',
      '| North | 1,200 | 12% |',
      '| South | 950 | 8% |',
      'Source: internal dashboard',
      '',
      '## Next steps',
      '- Expand to two more sites',
      '- Review in March',
    ].join('\n'));
    expect(draft.slides.map((s) => s.kind)).toEqual(['title', 'table', 'bullets']);
    const t = draft.slides[1];
    expect(t.content.title).toBe('Pilot results');
    expect(t.content.caption).toBe('Source: internal dashboard');
    const parsed = parseTable(String(t.content.cells));
    expect(parsed.rows).toEqual([['Site', 'Users', 'Growth'], ['North', '1,200', '12%'], ['South', '950', '8%']]);
    expect(parsed.align[1]).toBe('right');
  });

  it('leaves lines with a stray pipe alone', () => {
    const draft = outlineToDraft('# Deck\n\n## Options\n- A | B\n- C');
    expect(draft.slides[1].kind).toBe('bullets');
  });
});

// jsdom ships no type declarations here, so load it by name and describe the one thing used.
type XmlDoc = { getElementsByTagName(name: string): { length: number } };
let parser: { parseFromString(xml: string, type: string): XmlDoc };
beforeAll(async () => {
  const name = 'jsdom';
  const { JSDOM } = (await import(/* @vite-ignore */ name)) as { JSDOM: new (html: string) => { window: { DOMParser: new () => typeof parser } } };
  parser = new (new JSDOM('').window.DOMParser)();
});

describe('PowerPoint charts and tables', () => {
  const chartContent = getKind('chart')!.create();
  const deck: Deck = {
    id: 'd', title: 'Data', themeId: 'midnight', audience: 'adult', createdAt: 0, updatedAt: 0,
    slides: [
      slide('a', 'chart', chartContent),
      slide('b', 'chart', chartContent, 'bar'),
      slide('c', 'chart', chartContent, 'line'),
      slide('d', 'chart', chartContent, 'pie'),
      slide('e', 'chart', chartContent, 'doughnut'),
      slide('f', 'table', getKind('table')!.create()),
    ],
  };

  it('writes native charts and a native table', async () => {
    const result = await exportDeckToPptx(deck, { output: 'nodebuffer' });
    expect(result.warnings).toEqual([]);
    const zip = await JSZip.loadAsync(result.data as Uint8Array);
    const charts = Object.keys(zip.files).filter((p) => /^ppt\/charts\/chart\d+\.xml$/.test(p));
    expect(charts).toHaveLength(5);
    const kinds = await Promise.all(charts.map((p) => zip.file(p)!.async('string')));
    const all = kinds.join('\n');
    for (const tag of ['<c:barChart>', '<c:lineChart>', '<c:pieChart>', '<c:doughnutChart>']) expect(all).toContain(tag);
    expect(all).toContain('<c:barDir val="bar"/>');
    expect(all).toContain('<c:barDir val="col"/>');
    for (const path of Object.keys(zip.files).filter((p) => /^ppt\/(slides|charts)\/[^/]+\.xml$/.test(p))) {
      const doc = parser.parseFromString(await zip.file(path)!.async('string'), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, `${path} is not well-formed`).toBe(0);
    }
    expect(all).toContain('formatCode="&quot;$&quot;#,##0"');
    const tableSlide = await zip.file('ppt/slides/slide6.xml')!.async('string');
    expect(tableSlide).toContain('<a:tbl>');
    expect(tableSlide).toContain('Business');
    const ids = [...tableSlide.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('colours one highlighted column or bar by itself in PowerPoint', async () => {
    const content = { title: 'Sales', rows: [{ label: 'North', value: '12' }, { label: 'South', value: '30' }, { label: 'East', value: '9' }], takeaway: 'The South sold most.' };
    const result = await exportDeckToPptx({ ...deck, themeId: 'paper', slides: [slide('a', 'chart', content), slide('b', 'chart', content, 'bar')] }, { output: 'nodebuffer' });
    const zip = await JSZip.loadAsync(result.data as Uint8Array);
    const charts = await Promise.all(Object.keys(zip.files).filter((p) => /^ppt\/charts\/chart\d+\.xml$/.test(p)).sort().map((p) => zip.file(p)!.async('string')));
    const accent = getTheme('paper').colors.accent.slice(1).toUpperCase();
    const dpt = (xml: string) => [...xml.matchAll(/<c:dPt>[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"/g)].map((m) => m[1]);
    expect(dpt(charts[0]!)).toHaveLength(3);
    expect(dpt(charts[0]!)[1]).toBe(accent);
    // Bars run bottom-up in PowerPoint, so South is still the middle one.
    expect(dpt(charts[1]!)[1]).toBe(accent);
    expect(dpt(charts[1]!)[0]).not.toBe(accent);
  });

  it('animates charts and tables that appear on a click', async () => {
    registerKind({
      kind: 'test.reveal-data', label: 'Reveal data', description: '', icon: 'table', group: 'Data', fields: [],
      create: () => ({}), text: () => [], heading: () => 'Reveal data',
      layout(_c, ctx) {
        const chart = getKind('chart')!.layout(chartContent, ctx).boxes.find((b) => b.type === 'chart')!;
        const table = getKind('table')!.layout(getKind('table')!.create(), ctx).boxes.find((b) => b.type === 'table')!;
        return { boxes: [{ ...chart, h: 300, step: 1 }, { ...table, y: 600, step: 2 }] };
      },
    });
    const d: Deck = { ...deck, slides: [slide('x', 'test.reveal-data', {}), slide('y', 'test.reveal-data', {})] };
    const zip = await JSZip.loadAsync((await exportDeckToPptx(d, { output: 'nodebuffer' })).data as Uint8Array);
    for (const path of ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']) {
      const xml = await zip.file(path)!.async('string');
      expect(xml.match(/nodeType="clickEffect"/g)).toHaveLength(2);
      for (const step of [1, 2]) {
        const id = new RegExp(`<p:cNvPr id="(\\d+)" name="s${step}-`).exec(xml)?.[1];
        expect(id, `${path} step ${step}`).toBeTruthy();
        expect(xml).toContain(`<p:spTgt spid="${id}"/>`);
      }
    }
  });
});

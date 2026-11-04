import { describe, expect, it } from 'vitest';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import type { DeckDraft } from '../src/core/plugins/api';
import { type PhotoDeps, addFoundPhotos, photoField } from '../src/features/autodeck/photos';
import { researchSource, researchText } from '../src/features/autodeck/research';

registerCoreKinds();

const found = (id: string, license: string, url = `https://img.example/${id}.jpg`) => ({
  id, provider: 'openverse', title: `Photo ${id}`, thumb: url, url, page: `https://img.example/${id}`, width: 1600, height: 900,
  mime: 'image/jpeg', author: 'A. Person', license, licenseUrl: '', text: '',
});

function deps(o: { results?: ReturnType<typeof found>[]; providers?: string[]; failFirst?: boolean } = {}) {
  const kept: string[] = [];
  const searched: string[] = [];
  let fails = o.failFirst ? 1 : 0;
  const d: PhotoDeps = {
    providers: async () => o.providers ?? ['openverse'],
    search: async (_p, q) => { searched.push(q); return (o.results ?? [found('a', 'CC BY 4.0')]) as never; },
    keep: async (p) => {
      if (fails-- > 0) throw new Error('no download');
      kept.push(p.url);
      return `asset:${p.id}`;
    },
  };
  return { d, kept, searched };
}

const draft = (): DeckDraft => ({
  title: 'T',
  minutes: 10,
  slides: [
    { kind: 'title', content: { title: 'Chinese in East Java' } },
    { kind: 'image', content: { title: 'Surabaya', image: '' } },
    { kind: 'chart', content: { title: 'Learners' } },
    { kind: 'image', content: { title: 'Own picture', image: 'asset:mine' } },
  ],
});

describe('photos from free libraries', () => {
  it('fills the empty picture field of each slide whose outline names a search', async () => {
    const { d, searched } = deps({ results: [found('a', 'CC BY 4.0'), found('b', 'CC0')] });
    const outline = [{}, { search: 'Surabaya skyline' }, { search: 'chart' }, { search: 'classroom' }];
    const out = await addFoundPhotos(draft(), outline, { deps: d });
    expect(searched).toEqual(['Surabaya skyline']);
    expect(out.added).toBe(1);
    expect(out.draft.slides[1]!.content!.image).toMatch(/^asset:/);
    // The slide that already had a picture keeps it, and a chart has no picture field.
    expect(out.draft.slides[3]!.content!.image).toBe('asset:mine');
    expect(photoField('chart')).toBeUndefined();
  });

  it('never places a picture whose licence is limited or unclear, and tries the next when a download fails', async () => {
    const limited = await addFoundPhotos(draft(), [{}, { search: 'x' }], { deps: deps({ results: [found('n', 'CC BY-NC-ND 4.0')] }).d });
    expect(limited.added).toBe(0);
    const retry = deps({ results: [found('a', 'CC0'), found('b', 'CC0')], failFirst: true });
    const out = await addFoundPhotos(draft(), [{}, { search: 'x' }], { deps: retry.d });
    expect(out.added).toBe(1);
    expect(retry.kept).toHaveLength(1);
  });

  it('does nothing without a picture library on the server', async () => {
    const out = await addFoundPhotos(draft(), [{}, { search: 'x' }], { deps: deps({ providers: [] }).d });
    expect(out).toMatchObject({ added: 0, wanted: 1 });
  });
});

describe('web research as a source', () => {
  it('becomes a ready document with its notes and every source’s address and date', () => {
    const result = { notes: '## Schools\n- 120 schools teach Mandarin (2025). [Dinas, 2025](https://dinas.example.go.id/a)', sources: [{ title: 'Dinas Pendidikan', url: 'https://dinas.example.go.id/a', date: '2025-05-01' }] };
    const text = researchText(result, '2026-11-04');
    expect(text).toContain('Searched on 4 Nov 2026.');
    expect(text).toContain('- Dinas Pendidikan (2025-05-01): https://dinas.example.go.id/a');
    const s = researchSource('src1', result, '2026-11-04');
    expect(s).toMatchObject({ id: 'src1', kind: 'doc', status: 'ready', found: result.sources });
    expect(s.file.name).toBe('Web research · 4 Nov 2026.md');
  });
});

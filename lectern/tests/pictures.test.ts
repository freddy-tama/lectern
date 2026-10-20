import { beforeAll, describe, expect, it } from 'vitest';
import { openverseLicense, plainText } from '../api/picture-search';
import { picturePrompt } from '../api/picture-generate';
import type { Deck } from '../src/core/deck/types';
import { emptyNotes } from '../src/core/deck/types';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { type PictureCredit, creditLine, creditsText, deckPictures, licenseLimits, needsCredit, rightsOf } from '../src/core/pictures/credits';
import { type FoundPicture, isLogoOrIcon, isUsable, rankPictures, scorePicture, searchWords } from '../src/core/pictures/rank';

beforeAll(() => registerCoreKinds());

let n = 0;
function pic(over: Partial<FoundPicture> = {}): FoundPicture {
  n += 1;
  return {
    id: `t:${n}`, provider: 'openverse', title: 'Water cycle', thumb: `https://e.org/t${n}.jpg`, url: `https://e.org/${n}.jpg`,
    page: `https://e.org/p/${n}`, width: 1600, height: 900, mime: 'image/jpeg', author: `Author ${n}`, license: 'CC BY 4.0',
    licenseUrl: '', text: '', order: 3, ...over,
  };
}

describe('picture rights', () => {
  it('reads licences the way libraries write them', () => {
    expect(rightsOf('CC0 1.0')).toBe('free');
    expect(rightsOf('Public domain')).toBe('free');
    expect(rightsOf('Public Domain Mark')).toBe('free');
    expect(rightsOf('Pexels License')).toBe('free');
    expect(rightsOf('CC BY 4.0')).toBe('credit');
    expect(rightsOf('CC BY-SA 3.0')).toBe('credit');
    expect(rightsOf('Creative Commons Attribution-Share Alike 4.0')).toBe('credit');
    expect(rightsOf('CC BY-NC-ND 2.0')).toBe('limited');
    expect(rightsOf('CC BY-ND 4.0')).toBe('limited');
    expect(rightsOf('')).toBe('unclear');
    expect(rightsOf('All rights reserved')).toBe('unclear');
  });

  it('spells out what a limited licence allows', () => {
    expect(licenseLimits('CC BY-NC-SA 2.0')).toBe('not for commercial use; share changes under the same licence');
    expect(licenseLimits('CC BY-ND 4.0')).toBe('don’t crop or change it');
  });

  it('formats Openverse licence ids', () => {
    expect(openverseLicense('by-nc-nd', '2.0')).toBe('CC BY-NC-ND 2.0');
    expect(openverseLicense('cc0', '1.0')).toBe('CC0 1.0');
    expect(openverseLicense('pdm', '')).toBe('Public Domain Mark');
  });

  it('strips the HTML Commons puts in author fields', () => {
    expect(plainText('<a href="//commons.wikimedia.org/wiki/User:T" title="User:T">Tttrung</a> &amp; friends')).toBe('Tttrung & friends');
  });
});

describe('ranking pictures', () => {
  it('drops logos and icons unless they were searched for', () => {
    expect(isLogoOrIcon({ title: 'Company logo', text: '' })).toBe(true);
    expect(isLogoOrIcon({ title: 'Weather icons set', text: '' })).toBe(true);
    expect(isLogoOrIcon({ title: 'Rain', text: 'clip art cloud' })).toBe(true);
    expect(isLogoOrIcon({ title: 'An iconic bridge', text: '' })).toBe(false);
    expect(isLogoOrIcon({ title: 'Company logo', text: '' }, 'logo design')).toBe(false);
    const ranked = rankPictures([pic({ title: 'Water cycle icon' }), pic()], 'water cycle');
    expect(ranked).toHaveLength(1);
    expect(ranked[0].title).toBe('Water cycle');
  });

  it('drops tiny pictures and formats slides cannot hold', () => {
    expect(isUsable(pic({ width: 300, height: 200 }))).toBe(false);
    expect(isUsable(pic({ mime: 'image/svg+xml' }))).toBe(false);
    expect(isUsable(pic({ mime: 'image/tiff' }))).toBe(false);
    expect(isUsable(pic({ width: 0, height: 0 }))).toBe(true);
    expect(scorePicture(pic({ width: 320, height: 240 }), 'water')).toBeNull();
  });

  it('prefers pictures free to reuse, then ones that need a credit, then unclear rights', () => {
    const free = pic({ license: 'CC0 1.0' });
    const credit = pic({ license: 'CC BY 2.0' });
    const limited = pic({ license: 'CC BY-NC 2.0' });
    const unclear = pic({ license: '' });
    const ranked = rankPictures([unclear, limited, credit, free], 'water cycle');
    expect(ranked.map((p) => p.rights)).toEqual(['free', 'credit', 'limited', 'unclear']);
  });

  it('prefers bigger pictures', () => {
    const big = pic({ width: 2400, height: 1350 });
    const small = pic({ width: 640, height: 360 });
    expect(rankPictures([small, big], 'water cycle')[0].id).toBe(big.id);
  });

  it('prefers the shape the slide needs', () => {
    const wide = pic({ width: 1920, height: 1080 });
    const tall = pic({ width: 1080, height: 1440 });
    expect(rankPictures([tall, wide], 'water cycle', { shape: 'wide' })[0].id).toBe(wide.id);
    expect(rankPictures([wide, tall], 'water cycle', { shape: 'tall' })[0].id).toBe(tall.id);
    const square = pic({ width: 1200, height: 1200 });
    expect(rankPictures([wide, square, tall], 'water cycle', { shape: 'square' })[0].id).toBe(square.id);
  });

  it('puts relevant pictures first and size alone does not beat relevance', () => {
    const relevant = pic({ title: 'The water cycle explained', width: 1024, height: 640 });
    const unrelated = pic({ title: 'Sunset at the beach', width: 3000, height: 1700 });
    expect(rankPictures([unrelated, relevant], 'water cycle')[0].id).toBe(relevant.id);
  });

  it('matches words in any script, ignoring filler words', () => {
    expect(searchWords('The Water cycle of the Earth')).toEqual(['water', 'cycle', 'earth']);
    expect(searchWords('水循环')).toEqual(['水循环']);
    const zh = pic({ title: '水循环 示意图' });
    expect((scorePicture(zh, '水循环') ?? 0) > (scorePicture(pic({ title: 'Mountains' }), '水循环') ?? 0)).toBe(true);
  });

  it('removes dismissed results and duplicates of the same picture', () => {
    const a = pic();
    const b = pic({ url: `${a.url}?utm_source=x`, id: 'commons:dupe' });
    const c = pic({ title: 'Same picture', author: 'Jo' });
    const d = pic({ title: 'Same picture', author: 'Jo', provider: 'commons' });
    const e = pic();
    const ranked = rankPictures([a, b, c, d, e], 'water cycle', { dismissed: new Set([e.id]) });
    expect(ranked.map((p) => p.id).sort()).toEqual([a.id, c.id].sort());
  });

  it('marks screenshots and maps down unless asked for', () => {
    const photo = pic({ title: 'Water cycle' });
    const shot = pic({ title: 'Water cycle screenshot' });
    expect((scorePicture(photo, 'water cycle') ?? 0) > (scorePicture(shot, 'water cycle') ?? 0)).toBe(true);
  });
});

describe('credits', () => {
  const base: PictureCredit = { source: 'openverse', rights: 'credit', addedAt: 0 };

  it('writes title, author, licence and source in one line', () => {
    expect(creditLine({ ...base, title: 'Water cycle', author: 'menteblu61', license: 'CC BY-NC-ND 2.0', page: 'https://www.flickr.com/photos/x/1' }))
      .toBe('“Water cycle” by menteblu61 · CC BY-NC-ND 2.0 · https://www.flickr.com/photos/x/1');
    expect(creditLine({ ...base, source: 'pexels', author: 'Jo', license: 'Pexels License' })).toBe('Picture by Jo · Pexels License · Pexels');
    expect(creditLine({ ...base, source: 'ai', rights: 'ai', model: 'gpt-image-1-mini' })).toBe('AI-generated picture (gpt-image-1-mini)');
    expect(creditLine({ ...base, source: 'upload', rights: 'own' })).toBe('');
    expect(creditLine({ ...base, source: 'upload', rights: 'own', author: 'Sam' })).toBe('Picture by Sam');
  });

  it('knows which pictures need a visible credit', () => {
    expect(needsCredit({ ...base, rights: 'credit' })).toBe(true);
    expect(needsCredit({ ...base, rights: 'limited' })).toBe(true);
    expect(needsCredit({ ...base, rights: 'free' })).toBe(false);
    expect(needsCredit({ ...base, source: 'link', rights: 'unclear' })).toBe(true);
    expect(needsCredit({ ...base, source: 'upload', rights: 'unclear' })).toBe(false);
    expect(needsCredit({ ...base, source: 'ai', rights: 'ai' })).toBe(false);
  });

  it('finds every picture in a deck, nested ones too, with the slides that use it', () => {
    const deck: Pick<Deck, 'slides'> = {
      slides: [
        { id: 's1', kind: 'title', content: { title: 'T', image: 'asset:a1' }, notes: emptyNotes() },
        { id: 's2', kind: 'gallery', content: { title: 'G', images: [{ image: 'asset:a2', caption: '' }, { image: 'asset:a1', caption: '' }] }, notes: emptyNotes() },
        { id: 's3', kind: 'people', content: { title: 'P', people: [{ name: 'Ann', role: '', photo: 'https://e.org/ann.jpg' }] }, notes: emptyNotes(), hidden: true },
        { id: 's4', kind: 'missing.kind', content: { pic: 'asset:a3', other: 'text' }, notes: emptyNotes() },
        { id: 's5', kind: 'bullets', content: { title: 'B', bullets: ['asset:not-a-field'], image: '' }, notes: emptyNotes() },
      ],
    };
    expect(deckPictures(deck)).toEqual([
      { ref: 'asset:a1', slides: [1, 2], hiddenOnly: false },
      { ref: 'asset:a2', slides: [2], hiddenOnly: false },
      { ref: 'https://e.org/ann.jpg', slides: [3], hiddenOnly: true },
      { ref: 'asset:a3', slides: [4], hiddenOnly: false },
    ]);
  });

  it('copies all credits as plain text', () => {
    expect(creditsText('Rain', [{ slides: [2, 5], line: 'Picture by Jo' }, { slides: [3], line: '' }])).toBe('Picture credits for “Rain”\n\nSlides 2, 5: Picture by Jo');
    expect(creditsText('Rain', [])).toBe('');
  });
});

describe('AI picture prompts', () => {
  it('follows the look and audience, and asks for no text', () => {
    const young = picturePrompt('a raindrop falling into a lake', { audience: 'young', look: 'Playful', colors: ['#FFF8E7', '#E4572E', 'red'] });
    expect(young).toContain('flat illustration');
    expect(young).toContain('children aged 6 to 11');
    expect(young).toContain('"Playful"');
    expect(young).toContain('#FFF8E7, #E4572E');
    expect(young).not.toContain('red;');
    expect(young).toContain('No words, letters');
    expect(picturePrompt('a team meeting', { audience: 'adult', purpose: 'pitch' })).toContain('photograph');
    expect(picturePrompt('a fox', { kind: 'drawing', audience: 'young' })).toContain('line drawing');
  });
});

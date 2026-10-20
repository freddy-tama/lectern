import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSlide } from '../src/core/deck/draft';
import type { Deck, Slide } from '../src/core/deck/types';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { type PictureCredit, slideCreditLines } from '../src/core/pictures/credits';
import { type SharedAsset, receivedAsset, sharedAsset } from '../src/core/share/protocol';
import { db } from '../src/data/db';
import { pictureCredits } from '../src/features/pictures/store';
import { deckHtml } from '../src/features/share/standalone';

// 1 × 1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const clouds: PictureCredit = { source: 'commons', rights: 'credit', title: 'Clouds', author: 'Ana & <Bo>', license: 'CC BY 2.0', page: 'https://e.org/p?a=1&b=2', addedAt: 0 };
const hiddenOnly: PictureCredit = { source: 'openverse', rights: 'credit', author: 'Only on a hidden slide', license: 'CC BY 4.0', addedAt: 0 };
const mine: PictureCredit = { source: 'upload', rights: 'own', addedAt: 0 };

beforeAll(() => registerCoreKinds());

async function addAsset(id: string, credit?: PictureCredit) {
  await db.assets.put({ id, blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', name: id, createdAt: 0, ...(credit ? { credit } : {}) });
}

const picture = (image: string, extra: Partial<Slide> = {}): Slide => ({ ...makeSlide('image', { title: 'Look', body: '', image, caption: '' }), ...extra });

function deck(slides: Slide[]): Deck {
  return { id: 'd', title: 'Rain', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0, slides };
}

/** The credits page of an exported web page, or '' when there is none. */
const creditsPage = (html: string) => /<section class="page-slide page-credits"[^]*?<\/section>/.exec(html)?.[0] ?? '';

beforeEach(async () => {
  await db.assets.clear();
  // Plain links are fetched to inline them; there's no network here.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
});

afterEach(() => vi.unstubAllGlobals());

describe('picture credits in the web page export', () => {
  it('ends the page with a credit for each picture, numbered as the page shows the slides', async () => {
    await addAsset('clouds', clouds);
    await addAsset('hidden', hiddenOnly);
    await addAsset('mine', mine);
    const html = await deckHtml(deck([
      picture('asset:hidden', { hidden: true }),
      picture('asset:clouds'),
      makeSlide('bullets', { title: 'No picture', bullets: ['x'], image: '' }),
      picture('asset:clouds'),
      picture('asset:mine'),
      picture('https://pics.example/rain.jpg'),
    ]));
    const page = creditsPage(html);
    expect(page).toContain('<h2>Picture credits</h2>');
    expect(page).toContain('hidden');
    // Hidden slides aren't on the page, so the slides it shows are numbered 1 to 5.
    expect(page).toContain('<li><b>Slides 1, 3</b>“Clouds” by Ana &amp; &lt;Bo&gt; · CC BY 2.0 · <a href="https://e.org/p?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https://e.org/p?a=1&amp;b=2</a></li>');
    expect(page).toContain('<li><b>Slide 5</b>Picture · <a href="https://pics.example/rain.jpg"');
    expect(page).not.toContain('Only on a hidden slide');
    // Your own upload with no details has nothing to credit.
    expect(page).not.toContain('Slide 4');
    expect(page.match(/<li>/g)).toHaveLength(2);
    // The page comes after the last slide, and the counter only counts real slides.
    expect(html.indexOf('aria-label="Slide 5"')).toBeLessThan(html.indexOf('page-credits"'));
    expect(html).toContain(".page-slide:not(.page-credits)");
  });

  it('adds no credits page when nothing needs one, or when the deck has its own credits slide', async () => {
    await addAsset('clouds', clouds);
    await addAsset('mine', mine);
    expect(creditsPage(await deckHtml(deck([picture('asset:mine'), makeSlide('bullets', { title: 'Words', bullets: ['x'], image: '' })])))).toBe('');
    const own = await deckHtml(deck([picture('asset:clouds'), makeSlide('credits', { lines: ['Slide 1: “Clouds” by Ana & <Bo>'] })]));
    expect(creditsPage(own)).toBe('');
  });
});

describe('picture credits on phones the deck is shared with', () => {
  it('sends each picture’s credit with the picture, and only when there is one', () => {
    const shared = sharedAsset({ id: 'clouds', mime: 'image/png', name: 'clouds.png', credit: clouds }, PNG);
    expect(shared).toEqual({ id: 'clouds', mime: 'image/png', name: 'clouds.png', data: PNG, credit: clouds });
    expect('credit' in sharedAsset({ id: 'old', mime: 'image/png', name: 'old.png' }, PNG)).toBe(false);
  });

  it('keeps the credit on the phone and shows it under the slide that has the picture', async () => {
    const sent: SharedAsset = JSON.parse(JSON.stringify(sharedAsset({ id: 'clouds', mime: 'image/png', name: 'clouds.png', credit: clouds }, PNG)));
    const kept = receivedAsset(sent, 5);
    expect(kept).toMatchObject({ id: 'clouds', mime: 'image/png', name: 'clouds.png', createdAt: 5, credit: clouds });
    expect(kept.blob.type).toBe('image/png');
    expect(kept.blob.size).toBe(70);
    await db.assets.put(kept);
    await db.assets.put(receivedAsset({ id: 'old', mime: 'image/png', name: 'old.png', data: PNG }));

    const slide = picture('asset:clouds');
    const credits = await pictureCredits(['asset:clouds', 'asset:old']);
    expect(slideCreditLines(slide, credits)).toEqual(['“Clouds” by Ana & <Bo> · CC BY 2.0 · https://e.org/p?a=1&b=2']);
    // A package from before credits travelled: the picture shows, with nothing to credit.
    expect(slideCreditLines(picture('asset:old'), credits)).toEqual([]);
    expect(slideCreditLines(makeSlide('bullets', { title: 'Words', bullets: ['x'], image: '' }), credits)).toEqual([]);
  });

  it('ignores a credit that isn’t one', () => {
    const odd = { id: 'x', mime: 'image/png', name: 'x.png', data: PNG, credit: 'by someone' } as unknown as SharedAsset;
    expect(receivedAsset(odd).credit).toBeUndefined();
  });
});

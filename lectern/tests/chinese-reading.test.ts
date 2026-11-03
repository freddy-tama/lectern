// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import type { Box, TextBox } from '../src/core/engine/boxes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { installPlugin } from '../src/core/plugins/registry';
import chinese from '../plugins/chinese/index';
import { cloze, reading } from '../plugins/chinese/reading';
import { nameSpans, placeBlanks, rubyCells, rubyLines, syllablesOf } from '../plugins/chinese/ruby';

installPlugin(chinese);

// 1 × 1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const LONDON = '小明和妈妈去英国看奶奶。奶奶住在伦敦，她的家旁边有一个美丽的公园。';
const LONDON_PY = 'Xiǎo Míng hé māma qù Yīngguó kàn nǎinai. Nǎinai zhù zài Lúndūn, tā de jiā pángbiān yǒu yí gè měilì de gōngyuán.';
const SUN = '孙中山在英国生活很艰苦。';
const SUN_PY = 'Sūn Zhōngshān zài Yīngguó shēnghuó hěn jiānkǔ.';

const slide = (kind: string, content: Record<string, unknown>, variant?: string): Slide => ({ id: 's1', kind, content, notes: emptyNotes(), variant });
const lay = (s: Slide, audience: 'young' | 'teen' | 'adult' = 'teen') => layoutSlide(s, { theme: getTheme('paper'), audience, mode: 'show' });
const texts = (boxes: Box[]) => boxes.filter((b): b is TextBox => b.type === 'text');
const chars = (value: string) => Array.from(value);

describe('pinyin over each character', () => {
  it('pairs each character with its syllable, capitals kept', () => {
    expect(syllablesOf(SUN_PY)).toEqual(['Sūn', 'Zhōng', 'shān', 'zài', 'Yīng', 'guó', 'shēng', 'huó', 'hěn', 'jiān', 'kǔ']);
    const cells = rubyCells(SUN, SUN_PY)!;
    expect(cells.map((c) => `${c.ch}${c.py}`).join(' ')).toBe('孙Sūn 中Zhōng 山shān 在zài 英Yīng 国guó 生shēng 活huó 很hěn 艰jiān 苦kǔ 。');
  });

  it('reads a year digit by digit when the pinyin does, and leaves digits bare when it doesn’t', () => {
    expect(rubyCells('1866年', 'yī bā liù liù nián')!.map((c) => c.py)).toEqual(['yī', 'bā', 'liù', 'liù', 'nián']);
    expect(rubyCells('1866年', '1866 nián')!.map((c) => c.py)).toEqual(['', '', '', '', 'nián']);
  });

  it('gives 儿 run onto the syllable before it no syllable of its own', () => {
    expect(rubyCells('你去哪儿？', 'Nǐ qù nǎr?')!.map((c) => c.py)).toEqual(['Nǐ', 'qù', 'nǎr', '', '']);
  });

  it('returns null when the pinyin has a syllable too many or too few', () => {
    expect(rubyCells('我喜欢伦敦', 'Wǒ xǐhuan Lúndūn le')).toBeNull();
    expect(rubyCells('我喜欢伦敦', 'Wǒ xǐhuan')).toBeNull();
    expect(rubyCells('我喜欢伦敦', '')).toBeNull();
  });

  it('breaks lines without starting one on a closing mark or splitting a number', () => {
    const cells = rubyCells('他在1866年出生，后来去了英国。', 'Tā zài 1866 nián chūshēng, hòulái qù le Yīngguó.')!;
    const advance = (ch: string) => (/[0-9]/.test(ch) ? 0.6 : 1) * 10;
    for (let width = 30; width <= 160; width += 10) {
      const lines = rubyLines(cells, { width, advance, tracking: 2 });
      expect(lines.flat().map((c) => c.ch).join('')).toBe('他在1866年出生，后来去了英国。');
      for (const line of lines.slice(1)) expect('，。').not.toContain(line[0].ch);
      expect(lines.filter((line) => line.some((c) => /[0-9]/.test(c.ch))).length).toBe(1);
    }
  });
});

describe('names are never blanks', () => {
  it('finds names from capitalised syllables, not from capitals that start a sentence', () => {
    const names = nameSpans(LONDON, LONDON_PY).map(([a, b]) => chars(LONDON).slice(a, b).join(''));
    expect(names).toEqual(['小明', '英国', '伦敦']);
    // Part of a name is no name on its own: 小 of 小明 can still be blanked in 小鸟.
    expect(placeBlanks(`${LONDON}小鸟。`, ['小'], nameSpans(`${LONDON}小鸟。`, `${LONDON_PY} Xiǎo niǎo.`)).blanks.map((b) => b.start)).toEqual([chars(LONDON).length]);
  });

  it('counts a two-word name that starts a sentence', () => {
    const names = nameSpans(SUN, SUN_PY).map(([a, b]) => chars(SUN).slice(a, b).join(''));
    expect(names).toEqual(['孙中山', '英国']);
  });

  it('keeps a word that is part of a name out of the blanks', () => {
    const plan = placeBlanks(LONDON, ['英国', '国', '伦敦', '美丽', '公园'], nameSpans(LONDON, LONDON_PY));
    expect(plan.blanks.map((b) => b.word)).toEqual(['美丽', '公园']);
    expect(plan.skipped).toEqual([{ word: '英国', why: 'name' }, { word: '国', why: 'name' }, { word: '伦敦', why: 'name' }]);
  });

  it('skips a place where a word touches another blank, and words not in the text', () => {
    const plan = placeBlanks('美丽的公园，美丽的花。', ['美丽', '的', '小鸟'], []);
    expect(plan.blanks).toEqual([{ word: '美丽', start: 0, end: 2 }, { word: '的', start: 8, end: 9 }]);
    expect(plan.skipped).toEqual([{ word: '小鸟', why: 'missing' }]);
  });

  it('draws the cloze with 英国 still in the text and says why it isn’t a blank', () => {
    const out = lay(slide('chinese.cloze', { ...cloze.create(), words: ['英国', '旁边', '美丽'] }));
    const answers = texts(out.boxes).filter((b) => /^blank-\d+$/.test(b.id));
    expect(answers.map((b) => b.text)).toEqual(['旁边', '美丽']);
    expect(answers.map((b) => b.step)).toEqual([1, 2]);
    expect(answers.every((b) => b.reveal === 'answer')).toBe(true);
    const passage = texts(out.boxes).filter((b) => /^p0-l\d+$/.test(b.id)).map((b) => b.text).join('');
    expect(passage).toContain('英国');
    expect(passage).not.toContain('旁边');
    expect(passage.startsWith('　　小明')).toBe(true);
    expect(out.warnings.some((w) => w.includes('“英国” is a name'))).toBe(true);
    // The word bank holds the blanked words only, never in reading order.
    const bank = texts(out.boxes).filter((b) => /^bank-\d+$/.test(b.id)).map((b) => b.text);
    expect([...bank].sort()).toEqual(['旁边', '美丽'].sort());
    expect(bank).not.toEqual(['旁边', '美丽']);
  });
});

describe('the reading slide', () => {
  it('indents each paragraph two characters and puts each syllable over its character', () => {
    const out = lay(slide('chinese.reading', reading.create()));
    expect(out.warnings).toEqual([]);
    const all = texts(out.boxes);
    for (const p of [0, 1]) {
      const lines = all.filter((b) => new RegExp(`^p${p}-l\\d+$`).test(b.id));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0].text.startsWith('　　')).toBe(true);
      expect(lines.slice(1).every((b) => !b.text.startsWith('　'))).toBe(true);
    }
    // Over the first line: one box per syllable, centred on its character.
    const first = all.find((b) => b.id === 'p0-l0')!;
    const tracking = (first.style.tracking ?? 0) * first.style.size;
    const advance = first.style.size; // the test measure gives every character 1 em
    const pys = all.filter((b) => b.id.startsWith('p0-l0-py'));
    expect(pys.map((b) => b.text).slice(0, 4)).toEqual(['Xiǎo', 'Míng', 'hé', 'mā']);
    for (const b of pys) {
      const j = Number(/py(\d+)$/.exec(b.id)![1]);
      const centre = first.x + j * (advance + tracking) + advance / 2;
      expect(Math.abs(b.x + b.w / 2 - centre)).toBeLessThan(1);
      expect(b.y + b.h).toBeLessThanOrEqual(first.y + 1);
    }
  });

  it('shows a paragraph without pinyin when the pinyin doesn’t line up', () => {
    const content = reading.create();
    const paragraphs = (content.paragraphs as { text: string; pinyin: string }[]).map((p, i) => (i === 1 ? { ...p, pinyin: `${p.pinyin} le` } : p));
    const out = lay(slide('chinese.reading', { ...content, paragraphs }));
    expect(texts(out.boxes).some((b) => b.id.startsWith('p0-') && b.id.includes('py'))).toBe(true);
    expect(texts(out.boxes).some((b) => b.id.startsWith('p1-') && b.id.includes('py'))).toBe(false);
    expect(out.warnings.join(' ')).toContain('paragraph 2');
  });

  it('reveals each answer on its own click, with every question numbered', () => {
    const content = { ...reading.create(), questions: [{ q: '小明去哪儿？', a: '去英国。' }, { q: '奶奶住在哪儿？', a: '住在伦敦。' }, { q: '公园怎么样？', a: '很美丽。' }] };
    const out = lay(slide('chinese.reading', content));
    const answers = texts(out.boxes).filter((b) => /^a-\d$/.test(b.id));
    expect(answers.map((b) => [b.text, b.step, b.reveal])).toEqual([['去英国。', 1, 'answer'], ['住在伦敦。', 2, 'answer'], ['很美丽。', 3, 'answer']]);
    expect(texts(out.boxes).filter((b) => /^q-\d-n$/.test(b.id)).map((b) => b.text)).toEqual(['1', '2', '3']);
    expect(out.steps).toBe(3);
  });

  it('shrinks the picture before it drops it', () => {
    const content = reading.create();
    const first = (content.paragraphs as object[])[0];
    const short = lay(slide('chinese.reading', { ...content, image: PNG, paragraphs: [first] }));
    expect(short.warnings).toEqual([]);
    expect(short.boxes.find((b) => b.id === 'image')!.w).toBe(800);
    // A longer passage: the picture gets narrower, but stays.
    const long = { ...content, image: PNG };
    const narrow = lay(slide('chinese.reading', long)).boxes.find((b) => b.id === 'image');
    expect(narrow).toBeDefined();
    expect(narrow!.w).toBeLessThan(800);
    expect(narrow!.w).toBeGreaterThanOrEqual(260);
    // Too long to sit beside any picture: it is left out, and the studio says so.
    const huge = { ...content, image: PNG, paragraphs: Array.from({ length: 4 }, () => ({ text: LONDON.repeat(2), pinyin: `${LONDON_PY} ${LONDON_PY}` })) };
    const dropped = lay(slide('chinese.reading', huge));
    expect(dropped.boxes.find((b) => b.id === 'image')).toBeUndefined();
    expect(dropped.warnings.join(' ')).toMatch(/picture is left out|doesn’t fit/);
  });

  it('keeps the questions where the chosen layout puts them', () => {
    const content = reading.create();
    const under = lay(slide('chinese.reading', content, 'under'));
    const beside = lay(slide('chinese.reading', content, 'beside'));
    const cardOf = (l: ReturnType<typeof lay>) => l.boxes.find((b) => b.id === 'q-card')!;
    const textOf = (l: ReturnType<typeof lay>) => l.boxes.find((b) => b.id === 'p0-l0')!;
    expect(cardOf(under).y).toBeGreaterThan(textOf(under).y);
    expect(cardOf(beside).x).toBeGreaterThan(textOf(beside).x + textOf(beside).w - 1);
  });
});

describe('PowerPoint export', () => {
  it('writes the indented paragraph, its syllables and the cloze answers', async () => {
    const deck: Deck = {
      id: 'd1', title: '课文', themeId: 'paper', audience: 'young', createdAt: 0, updatedAt: 0,
      slides: [
        { id: 's1', kind: 'chinese.reading', content: reading.create(), notes: emptyNotes() },
        { id: 's2', kind: 'chinese.cloze', content: cloze.create(), notes: emptyNotes() },
      ],
    };
    const { data } = await exportDeckToPptx(deck);
    const zip = await JSZip.loadAsync(data as Uint8Array);
    const one = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(one).toContain('　　小明');
    for (const py of ['Xiǎo', 'Yīng', 'guó', 'Lún']) expect(one).toContain(`>${py}<`);
    const two = await zip.file('ppt/slides/slide2.xml')!.async('string');
    for (const word of ['旁边', '美丽']) expect(two).toContain(`>${word}<`);
  });
});

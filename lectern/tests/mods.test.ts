// @vitest-environment jsdom
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { draftToDeck } from '../src/core/deck/draft';
import type { Deck } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { getKind } from '../src/core/kinds/registry';
import { installPlugin, installedPlugins, toggleDefaults } from '../src/core/plugins/registry';
import { buildSeed } from '../src/data/seed';
import chinese from '../plugins/chinese/index';
import { parseWordList, toneMarks } from '../plugins/chinese/pinyin';
import lessonPlan from '../plugins/lesson-plan/index';
import { assignStages, buildLessonPlan } from '../plugins/lesson-plan/plan';

installPlugin(chinese);
installPlugin(lessonPlan);

describe('pinyin', () => {
  it('turns tone numbers into tone marks', () => {
    expect(toneMarks('ni3 hao3')).toBe('nǐ hǎo');
    expect(toneMarks('Zhong1wen2')).toBe('Zhōngwén');
    expect(toneMarks('xue2sheng5')).toBe('xuésheng');
    expect(toneMarks('lv4 nu:3')).toBe('lǜ nǚ');
    expect(toneMarks('liu2 gui4 gou3')).toBe('liú guì gǒu');
    expect(toneMarks('xué')).toBe('xué');
  });

  it('reads word lists in several shapes', () => {
    const words = parseWordList(['山 shan1 mountain', '学校（xuéxiào）school', '1. 水 | shui | water', '木\tmù\twood, tree', '火 huǒ', '学生 xué sheng student', '他 tā he', '大 big', 'not chinese'].join('\n'));
    expect(words).toEqual([
      { hanzi: '山', pinyin: 'shān', meaning: 'mountain' },
      { hanzi: '学校', pinyin: 'xuéxiào', meaning: 'school' },
      { hanzi: '水', pinyin: 'shui', meaning: 'water' },
      { hanzi: '木', pinyin: 'mù', meaning: 'wood, tree' },
      { hanzi: '火', pinyin: 'huǒ', meaning: '' },
      { hanzi: '学生', pinyin: 'xué sheng', meaning: 'student' },
      { hanzi: '他', pinyin: 'tā', meaning: 'he' },
      { hanzi: '大', pinyin: '', meaning: 'big' },
    ]);
  });
});

describe('mods', () => {
  it('install their kinds under their own prefix', () => {
    expect(installedPlugins().map((p) => p.id)).toEqual(['chinese', 'lesson-plan']);
    for (const k of chinese.kinds ?? []) expect(getKind(k.kind)?.plugin).toBe('chinese');
    expect(toggleDefaults()['chinese.pinyin']).toBe(true);
  });

  for (const kind of chinese.kinds ?? []) {
    it(`lays out ${kind.kind} inside the slide, with and without pinyin`, () => {
      for (const audience of ['young', 'teen', 'adult'] as const) {
        const slide = { id: 's1', kind: kind.kind, content: kind.create(), notes: { script: '', keyPoints: [], cues: [], check: null, minutes: 2, links: [] } };
        const on = layoutSlide(slide, { theme: getTheme('paper'), audience, mode: 'show' });
        expect(on.warnings, `${kind.kind} ${audience}`).toEqual([]);
        for (const b of on.boxes) {
          if (b.id.startsWith('deco')) continue;
          expect(b.x, b.id).toBeGreaterThanOrEqual(0);
          expect(b.y, b.id).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w, b.id).toBeLessThanOrEqual(CANVAS_W + 1);
          expect(b.y + b.h, b.id).toBeLessThanOrEqual(CANVAS_H + 1);
        }
        const off = layoutSlide(slide, { theme: getTheme('paper'), audience, mode: 'show', flags: { 'chinese.pinyin': false } });
        const pinyin = (l: typeof on) => l.boxes.filter((b) => (b.id.includes('py') || b.id.includes('pinyin')) && b.type === 'text' && b.text);
        expect(pinyin(on).length).toBeGreaterThan(0);
        expect(pinyin(off).length).toBe(0);
        // Nothing else moves when pinyin is hidden.
        const place = (l: typeof on) => l.boxes.map((x) => `${x.id}:${Math.round(x.x)},${Math.round(x.y)},${Math.round(x.w)},${Math.round(x.h)}`);
        expect(place(off)).toEqual(place(on));
      }
    });
  }

  it('builds a word-list deck the studio can open', () => {
    const Panel = chinese.deckSources?.[0];
    expect(Panel?.id).toBe('chinese.words');
  });
});

describe('lesson plan', () => {
  const seed = buildSeed(new Date('2026-10-19T10:00:00'));
  const deck = seed.decks.find((d) => d.id === 'deck_water_cycle') as Deck;

  it('assigns stages in order and keeps mid-lesson checks in 讲解新知', () => {
    const stages = assignStages(deck.slides);
    const order = ['组织教学', '导入新课', '讲解新知', '巩固练习', '复习总结', '布置作业'];
    const idx = stages.map((s) => order.indexOf(s));
    expect(idx.every((v, i) => i === 0 || v >= idx[i - 1])).toBe(true);
    expect(stages[0]).toBe('组织教学');
    expect(stages).toContain('讲解新知');
  });

  it('respects a stage the teacher set', () => {
    const d = draftToDeck({ title: 'T', slides: [{ kind: 'title', content: {} }, { kind: 'bullets', content: {} }, { kind: 'bullets', content: {} }] }, { audience: 'teen', themeId: 'paper' });
    d.slides[1].notes.extra = { 'lesson-plan': { stage: '导入新课' } };
    expect(assignStages(d.slides)).toEqual(['组织教学', '导入新课', '讲解新知']);
  });

  it('exports a Word document in the thirteen-item format', async () => {
    const withDetails: Deck = { ...deck, extra: { 'lesson-plan': { teacher: '李老师', goalsKnowledge: '能说出水循环的四个阶段\n能解释太阳的作用', homework: '画一幅水循环图' } } };
    const ex = lessonPlan.exporters![0];
    const out = await ex.run(withDetails, { resolveImage: async () => null, lesson: { title: 'The Water Cycle', summary: '', week: 1, date: '2026-10-06', durationMinutes: 50 } });
    expect(out.fileName).toBe('The Water Cycle 教案.docx');
    const zip = await JSZip.loadAsync(await out.data.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    const text = [...doc.getElementsByTagName('w:t')].map((t) => t.textContent).join('');
    for (const part of ['教  案', '一、试讲人：李老师', '三、教学日期：2026年10月6日', '八、教学目标：', '（1）能说出水循环的四个阶段', '十二、教学时间：50分钟', '十三、教学过程：', '（三）讲解新知', '【PPT 第', '板书设计：', '教学后记：', '画一幅水循环图', '（3）Evaporation【PPT 第5页】']) {
      expect(text, part).toContain(part);
    }
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(new DOMParser().parseFromString(styles, 'application/xml').getElementsByTagName('parsererror').length).toBe(0);
  });

  it('fills blanks rather than inventing header facts', () => {
    const { blocks } = buildLessonPlan(deck);
    const text = blocks.flatMap((b) => (b.type === 'p' ? b.runs.map((r) => r.text) : [])).join('\n');
    expect(text).toContain('二、指导教师：');
    expect(text).toContain('＿＿＿＿＿＿');
  });
});

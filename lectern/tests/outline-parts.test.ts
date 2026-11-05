// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { draftToDeck } from '../src/core/deck/draft';
import { notesToDeck } from '../src/core/deck/notes-to-deck';
import { outlineToDraft } from '../src/core/deck/outline';
import { stepsNamed } from '../src/core/deck/outline-parts';
import { type Slide, emptyNotes } from '../src/core/deck/types';
import { type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

// A plan as a chat assistant writes one: numbered slides between rules, every part under a bold
// label, notes for the speaker, layout advice, and production notes after the last slide.
const PLAN = `## PPT结构：《迟交的作业》案例分析（9页）

**整体逻辑：**呈现案例 → 分析问题 → 设计措施。

---

### 第1页｜封面

**主标题：作业为什么总是迟交？**

**副标题：**《迟交的作业》案例分析
**课程：**班级管理
**角标：**虚构案例

**版式建议：**标题居中，配一张书包的图。

---

### 第2页｜开场判断

**先给两行事实：**

> 小王一个月迟交五次作业。
> 老师在群里点了他的名。

**然后提问：**

> 老师应该在群里点名吗？

- A. 应该
- B. 不应该
- C. 看情况

**课堂操作：**
- 请同学举手选择。

**演讲者备注：**
先不评价对错，
最后再问一次。

---

### 第3页｜事情经过

**页面用时间轴呈现：**

一个月迟交五次
↓
老师群里点名
↓
小王不再回消息

**底部背景条：**

> 小王读初二。

---

### 第4页｜事实与说法

**左栏：已确认的事实**
- 迟交五次。
- 群里点名。

**右栏：各方说法**
- **小王：**作业太多。
- **老师：**只提醒过两次。

**核心提示：**

> 说法不等于结论。

---

### 第5页｜四个方面

**页面采用四格布局：**

| 学生 | 教师 |
|---|---|
| 原因不清。 | 方式不妥。 |

| 家庭 | 学校 |
|---|---|
| 压力很大。 | 没有渠道。 |

**底部大字：**

> 分别判断责任。

---

### 第6页｜三步路线

**下方放三步路线图：**

了解情况 → 共同约定 → 持续跟进

**演讲者备注：**
三步可以同时进行。

---

### 第7页｜第1步：了解情况

**页面要点：**
- 分别听取说法。
- 查明迟交原因。

**角标：程序公正**

---

### 第8页｜第2、3步：约定与跟进

**三栏布局：**

**学生：按原因调整**
- 不会做 → 讲解。

**教师：改变方式**
- 不再群里点名。

**学校：建立渠道**
- 设反馈信箱。

---

### 第9页｜效果评价

| 维度 | 看什么 |
|---|---|
| 作业 | 是否按时 |
| 关系 | 是否回消息 |

**底部：**

> 按时交作业不等于关系变好。

**追问：**

> 还要检查什么？

---

## 制作与展示要点

- **颜色保持一致。**
- **第7—8页顶部放进度条。**`;

const draft = () => outlineToDraft(PLAN, 'Untitled');
const content = (i: number) => draft().slides[i]!.content as Record<string, unknown>;

describe('a plan written slide by slide, with labelled parts', () => {
  it('makes one slide per numbered page, and none from the plan around them', () => {
    const d = draft();
    expect(d.slides.map((s) => s.kind)).toEqual(['title', 'bullets', 'question', 'steps', 'compare', 'cards', 'steps', 'bullets', 'cards', 'table']);
    expect(d.title).toBe('作业为什么总是迟交？');
    const all = JSON.stringify(d);
    expect(all).not.toContain('制作与展示要点');
    expect(all).not.toContain('整体逻辑');
    expect(all).not.toContain('**');
    expect(all).not.toContain('第1页');
  });

  it('turns the cover into the title slide and follows layout advice instead of showing it', () => {
    expect(content(0)).toMatchObject({ title: '作业为什么总是迟交？', subtitle: '《迟交的作业》案例分析', eyebrow: '虚构案例', credit: '课程：班级管理' });
    expect(JSON.stringify(draft())).not.toContain('书包');
  });

  it('shows what comes before the choices first, then asks, with cues and notes on the question', () => {
    expect(content(1)).toMatchObject({ title: '开场判断', bullets: ['小王一个月迟交五次作业。', '老师在群里点了他的名。'] });
    const ask = draft().slides[2]!;
    expect(ask.content).toEqual({ question: '老师应该在群里点名吗？', options: ['应该', '不应该', '看情况'], correct: -1, answer: '' });
    expect(ask.notes).toMatchObject({ script: '先不评价对错，最后再问一次。', cues: ['请同学举手选择。'] });
  });

  it('reads arrows as steps, with the bottom line under them', () => {
    expect(content(3)).toMatchObject({
      title: '事情经过',
      steps: [{ label: '一个月迟交五次', detail: '' }, { label: '老师群里点名', detail: '' }, { label: '小王不再回消息', detail: '' }],
      callout: '小王读初二。',
    });
    expect(content(6).steps).toHaveLength(3);
    expect(draft().slides[6]!.notes?.script).toBe('三步可以同时进行。');
  });

  it('makes columns of lists under their own headings, keeping each label that says something', () => {
    expect(content(4)).toMatchObject({
      leftHeading: '已确认的事实', leftPoints: ['迟交五次。', '群里点名。'],
      rightHeading: '各方说法', rightPoints: ['小王：作业太多。', '老师：只提醒过两次。'],
      callout: '核心提示：说法不等于结论。',
    });
    expect(content(8)).toMatchObject({ cards: [
      { heading: '学生：按原因调整', text: '不会做 → 讲解。' },
      { heading: '教师：改变方式', text: '不再群里点名。' },
      { heading: '学校：建立渠道', text: '设反馈信箱。' },
    ] });
  });

  it('turns small side-by-side tables into a grid of cards, and a real table keeps its key line as the caption', () => {
    expect(content(5)).toMatchObject({ cards: [{ heading: '学生', text: '原因不清。' }, { heading: '教师' }, { heading: '家庭' }, { heading: '学校', text: '没有渠道。' }], callout: '分别判断责任。' });
    expect(content(9)).toMatchObject({ cells: '维度 | 看什么\n作业 | 是否按时\n关系 | 是否回消息', caption: '按时交作业不等于关系变好。' });
    // A follow-up with no question to belong to is kept in the notes.
    expect(draft().slides[9]!.notes?.script).toContain('还要检查什么？');
  });

  it('puts a corner tag on its slide and the steps across the top of each step’s slide', () => {
    const steps = draft().slides.slice(7, 9).map((s) => s.elements ?? []);
    const marked = (els: typeof steps[number]) => els.filter((e) => e.type === 'text' && e.fill === 'accent').map((e) => e.type === 'text' && e.text);
    expect(marked(steps[0]!)).toEqual(['1 了解情况', '程序公正']);
    expect(marked(steps[1]!)).toEqual(['2 共同约定', '3 持续跟进']);
    expect(steps[1]!.filter((e) => e.type === 'text')).toHaveLength(3);
    // The strip stops short of the tag.
    const tag = steps[0]!.find((e) => e.type === 'text' && e.text === '程序公正')!;
    expect(Math.max(...steps[0]!.filter((e) => e !== tag).map((e) => e.x + e.w))).toBeLessThan(tag.x);
    // Slides that aren't steps of the plan get no strip.
    expect(draft().slides.slice(1, 7).flatMap((s) => s.elements ?? [])).toEqual([]);
  });

  it('keeps the elements and the bottom line through to the deck', () => {
    const deck = notesToDeck(PLAN, { audience: 'adult', purpose: 'talk', look: 'auto', maxSlides: Infinity });
    expect(deck.slides).toHaveLength(10);
    expect(deck.slides[7]!.elements).toHaveLength(4);
    expect(deck.slides[3]!.content.callout).toBe('小王读初二。');
    // Starter notes for Chinese slides end in Chinese stops.
    expect(deck.slides[1]!.notes.script).toBe('开场判断。小王一个月迟交五次作业。老师在群里点了他的名。');
  });
});

describe('labelled parts in English', () => {
  const plan = `# Late homework

## Slide 1: Where we start
**On screen:**
> Sam missed five deadlines in a month.

Q: What should the teacher do?
- A. Name him in the group chat
- B. Talk to him alone *

**Speaker notes:** Ask before you explain.
**Tag:** Case study

## Slide 2: Step 1: Listen
- Hear each side.
- Check the messages.

## Slide 3: Step 2: Agree
- Set reply times.

## Slide 4: The plan
1. Listen
2. Agree`;

  it('reads choices, notes and tags the same way', () => {
    const d = outlineToDraft(plan);
    expect(d.slides.map((s) => s.kind)).toEqual(['title', 'bullets', 'question', 'bullets', 'bullets', 'steps']);
    expect(d.slides[1]!.content).toMatchObject({ title: 'Where we start', bullets: ['Sam missed five deadlines in a month.'] });
    expect(d.slides[1]!.elements?.[0]).toMatchObject({ type: 'text', text: 'Case study' });
    expect(d.slides[2]).toMatchObject({ content: { question: 'What should the teacher do?', options: ['Name him in the group chat', 'Talk to him alone'], correct: 1 }, notes: { script: 'Ask before you explain.' } });
  });

  it('takes the line just before the choices as the question when there is no Q: line', () => {
    const d = outlineToDraft('# T\n\n## Slide 1: Vote\n> Should Sam be named?\n- A. Yes\n- B. No\n\n## Slide 2: End\n- x');
    expect(d.slides.map((s) => s.kind)).toEqual(['title', 'question', 'bullets']);
    expect(d.slides[1]!.content).toMatchObject({ question: 'Should Sam be named?', options: ['Yes', 'No'], correct: -1 });
  });

  it('only draws the steps when a slide of steps comes before them', () => {
    // The steps slide here comes last, so Step 1 and Step 2 have nothing to show yet.
    expect(outlineToDraft(plan).slides.flatMap((s) => s.elements ?? []).filter((e) => e.type === 'text' && e.text.startsWith('1 '))).toEqual([]);
  });

  it('names the steps a title covers', () => {
    expect(stepsNamed('第5、6步：必要时调整')).toEqual([5, 6]);
    expect(stepsNamed('第三步 修复')).toEqual([3]);
    expect(stepsNamed('Steps 2-4: Build')).toEqual([2, 3, 4]);
    expect(stepsNamed('Step 1: Listen')).toEqual([1]);
    expect(stepsNamed('Stepping back')).toEqual([]);
  });
});

describe('outline fixes for every outline', () => {
  it('starts no empty slide from a rule just before a heading', () => {
    const d = outlineToDraft('# T\n\n---\n\n## A\n- x\n\n---\n\n## B\n- y');
    expect(d.slides.map((s) => s.kind)).toEqual(['title', 'bullets', 'bullets']);
  });

  it('keeps points past the eighth in the script', () => {
    const d = outlineToDraft(`# T\n\n## Many\n${Array.from({ length: 10 }, (_, i) => `- Point ${i + 1}`).join('\n')}`);
    expect(d.slides[1]!.content.bullets).toHaveLength(8);
    expect(d.slides[1]!.notes?.script).toContain('Point 9 Point 10');
  });

  it('keeps a quoted line on a slide of points as its bottom line', () => {
    const d = outlineToDraft('# T\n\n## Why\n- One\n- Two\n\n> Remember this.');
    expect(d.slides[1]!.content).toMatchObject({ bullets: ['One', 'Two'], callout: 'Remember this.' });
  });

  it('reads a heading inside a numbered slide as a part of it', () => {
    const d = outlineToDraft('## 第1页 开场\n- 一\n#### 演讲者备注\n先说一。\n\n## 第2页 结尾\n- 二');
    expect(d.slides.map((s) => s.kind)).toEqual(['title', 'bullets', 'bullets']);
    expect(d.slides[1]!.notes?.script).toBe('先说一。');
  });

  it('leaves outlines without labels as they were', () => {
    const plain = '# Moon\n\n## Quick check\nQ: Why?\nA) Shadow\nB) The lit side *\nAnswer: B. It faces us.\n\n## A quote\n> To be or not to be.\n— Shakespeare';
    const d = outlineToDraft(plain);
    expect(d.slides.map((s) => s.kind)).toEqual(['title', 'question', 'quote']);
    expect(d.slides[1]!.content).toMatchObject({ options: ['Shadow', 'The lit side'], correct: 1 });
    expect(d.slides[2]!.content).toEqual({ quote: 'To be or not to be.', attribution: 'Shakespeare' });
  });
});

describe('the bottom line on a slide', () => {
  const slide = (kind: string, c: Record<string, unknown>, variant?: string): Slide => ({ id: 's', kind, content: c, variant, notes: emptyNotes({}) });
  const cases: [string, Record<string, unknown>, string?][] = [
    ['bullets', { title: '要点', bullets: ['一', '二', '三'], reveal: false, image: '' }],
    ['bullets', { title: '要点', bullets: ['一', '二', '三', '四', '五', '六'], reveal: false, image: '' }, 'columns'],
    ['compare', { title: '比较', leftHeading: '左', leftPoints: ['一'], rightHeading: '右', rightPoints: ['二'], reveal: false }],
    ['steps', { title: '步骤', steps: [{ label: '一', detail: '说明' }, { label: '二', detail: '说明' }], reveal: false }, 'across'],
    ['steps', { title: '步骤', steps: [{ label: '一', detail: '说明' }, { label: '二', detail: '说明' }], reveal: false }, 'down'],
    ['cards', { title: '四格', cards: [{ heading: '学生', text: '甲' }, { heading: '教师', text: '乙' }, { heading: '家庭', text: '丙' }, { heading: '学校', text: '丁' }], reveal: false }, 'grid'],
  ];
  for (const [kind, c, variant] of cases) {
    it(`sits under the content of ${kind}${variant ? ` (${variant})` : ''}`, () => {
      const layout = layoutSlide(slide(kind, { ...c, callout: '分别判断责任，不是各打五十大板。' }, variant), { theme: getTheme('paper'), audience: 'adult', slideCount: 3, slideNumber: 2 });
      const line = layout.boxes.find((b): b is TextBox => b.id === 'callout')!;
      expect(line.text).toBe('分别判断责任，不是各打五十大板。');
      expect(layout.warnings).toEqual([]);
      for (const b of layout.boxes) {
        if (b.id.startsWith('callout') || b.id.startsWith('deco') || b.id === 'page' || b.id === 'logo' || b.id.endsWith('-ph') || b.id.endsWith('-ph-t')) continue;
        expect(b.y + b.h, b.id).toBeLessThanOrEqual(line.y);
      }
      const without = layoutSlide(slide(kind, c, variant), { theme: getTheme('paper'), audience: 'adult' });
      expect(without.boxes.some((b) => b.id === 'callout')).toBe(false);
    });
  }

  it('stays when the slide is drafted into a deck', () => {
    const deck = draftToDeck({ title: 'T', slides: [{ kind: 'bullets', content: { title: 'A', bullets: ['x'], callout: 'Key line' } }] }, { audience: 'adult', themeId: 'paper' });
    expect(deck.slides[0]!.content.callout).toBe('Key line');
  });
});

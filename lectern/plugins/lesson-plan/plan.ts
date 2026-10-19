// Turns a deck and its key notes into a 教案 (lesson plan) in the thirteen-item
// course format: 说明部分, 教学目标, 重点, 难点, then 教学过程 by stage.
// Slides stay student-facing; every teaching term lives here.

import type { Deck, Slide } from '../../src/core/deck/types';
import { registerCoreKinds } from '../../src/core/kinds/core-kinds';
import { getKind } from '../../src/core/kinds/registry';
import type { ExportLesson } from '../../src/core/plugins/api';
import { type Block, item, p } from './docx';

export const MOD = 'lesson-plan';
export const STAGES = ['组织教学', '导入新课', '讲解新知', '巩固练习', '复习总结', '布置作业'] as const;
type Stage = (typeof STAGES)[number];
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const slideExtra = (s: Slide, key: string) => (s.notes.extra?.[MOD]?.[key] ?? '').trim();
const deckExtra = (d: Deck, key: string) => (d.extra?.[MOD]?.[key] ?? '').trim();
const lines = (v: string) => v.split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d+[.、)]|（\d+）|[-*•])\s*/, '').trim()).filter(Boolean);

/** The stage a slide's kind suggests on its own. */
function naturalStage(s: Slide, i: number): number {
  switch (s.kind) {
    case 'title': return i === 0 ? 0 : -1;
    case 'agenda': return 1;
    case 'question': case 'recall': return 3;
    case 'summary': return 4;
    case 'closing': return 5;
    default: return 2;
  }
}

/** Assigns each slide a stage. Stages never go backwards, and a check in the middle of teaching stays in 讲解新知. */
export function assignStages(slides: Slide[]): Stage[] {
  const natural = slides.map((s, i) => {
    const set = slideExtra(s, 'stage');
    return STAGES.includes(set as Stage) ? STAGES.indexOf(set as Stage) : naturalStage(s, i);
  });
  const lastTeach = natural.lastIndexOf(2);
  let current = 0;
  return slides.map((s, i) => {
    let n = natural[i];
    const explicit = Boolean(slideExtra(s, 'stage'));
    if (!explicit && (n === 3 || n === 4) && i < lastTeach) n = 2;
    if (n === -1) n = current;
    current = Math.max(current, n);
    return STAGES[current];
  });
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

const AUDIENCE: Record<Deck['audience'], string> = { young: '少儿', teen: '青少年', adult: '成人' };

function heading(s: Slide) {
  registerCoreKinds();
  return getKind(s.kind)?.heading(s.content) ?? s.kind;
}

/** 教师 / 学生 / 板书 lines for one slide. */
function stepLines(s: Slide): Block[] {
  const out: Block[] = [];
  const say = (label: string, text: string) => out.push(p('JScript', { text: `${label}：`, font: 'SimHei' }, text));
  const teacher = lines(slideExtra(s, 'teacher'));
  if (teacher.length) {
    teacher.forEach((t) => { const m = /^(教师|学生|板书|过渡语)[：:]\s*(.*)$/.exec(t); if (m) say(m[1], m[2]); else say('教师', t); });
  } else if (s.notes.script.trim()) {
    say('教师', s.notes.script.trim().replace(/\s*\n+\s*/g, ' '));
  }
  const student = lines(slideExtra(s, 'student'));
  student.forEach((t) => say('学生', t.replace(/^学生[：:]\s*/, '')));
  if (s.notes.check?.question) {
    say('教师', s.notes.check.question);
    if (s.notes.check.answer) say('学生', s.notes.check.answer);
  }
  const board = slideExtra(s, 'board');
  if (board) say('板书', board);
  const intent = slideExtra(s, 'intent');
  if (intent) say('设计意图', intent);
  return out;
}

export function buildLessonPlan(deck: Deck, lesson?: ExportLesson): { blocks: Block[]; minutes: number } {
  const slides = deck.slides.filter((s) => !s.hidden);
  const stages = assignStages(slides);
  const pageOf = new Map(deck.slides.filter((s) => !s.hidden).map((s, i) => [s.id, i + 1]));
  const byStage = STAGES.map((stage) => slides.filter((_, i) => stages[i] === stage));
  const stageMinutes = byStage.map((list, i) => {
    const m = Math.round(list.reduce((sum, s) => sum + (s.notes.minutes || 0), 0));
    if (m) return m;
    return i === 0 ? 1 : i === 5 ? 2 : 0;
  });
  const total = lesson?.durationMinutes ?? stageMinutes.reduce((a, b) => a + b, 0);
  const homework = lines(deckExtra(deck, 'homework'));

  const blocks: Block[] = [p('JTitle', '教  案')];
  const blank = '＿＿＿＿＿＿';
  blocks.push(item('一、试讲人：', deckExtra(deck, 'teacher') || blank));
  blocks.push(item('二、指导教师：', deckExtra(deck, 'supervisor') || blank));
  blocks.push(item('三、教学日期：', formatDate(lesson?.date) || blank));
  blocks.push(item('四、教学地点：', deckExtra(deck, 'place') || blank));
  blocks.push(item('五、教学对象：', deckExtra(deck, 'learners') || AUDIENCE[deck.audience]));
  blocks.push(item('六、所用教材：', deckExtra(deck, 'textbook') || blank));
  blocks.push(item('七、教学内容：', deckExtra(deck, 'content') || lesson?.title || deck.title));

  blocks.push(item('八、教学目标：'));
  const goals: [string, string][] = [['认知目标', 'goalsKnowledge'], ['技能目标', 'goalsSkill'], ['情感目标', 'goalsAffect']];
  goals.forEach(([label, key], i) => {
    blocks.push(p('JSub', `${i + 1}. ${label}：`));
    const list = lines(deckExtra(deck, key));
    (list.length ? list : [blank]).forEach((g, j) => blocks.push(p('JBody', `（${j + 1}）${g}`)));
  });
  for (const [n, label, key] of [['九', '教学重点', 'focus'], ['十', '教学难点', 'difficulties']] as const) {
    blocks.push(item(`${n}、${label}：`));
    const list = lines(deckExtra(deck, key));
    (list.length ? list : [blank]).forEach((g, j) => blocks.push(p('JBody', `${j + 1}. ${g}`)));
  }
  blocks.push(item('十一、教具准备：', deckExtra(deck, 'aids') || 'PPT课件'));
  blocks.push(item('十二、教学时间：', `${total}分钟`));
  blocks.push(item('十三、教学过程：'));

  // Summary table: 教学环节 | 时间 | 主要内容
  const summaryRow = (stage: Stage, list: Slide[]) => {
    if (stage === '组织教学' && !list.length) return '师生问候，检查出勤，做好课前准备。';
    if (stage === '布置作业' && !list.length) return homework.slice(0, 2).map((h) => h.split(/[，,]/)[0]).join('；') + (homework.length ? '。' : '');
    const names = [...new Set(list.map((s) => slideExtra(s, 'method') || heading(s)).filter(Boolean))];
    return names.length ? `${names.join('；')}。` : '';
  };
  blocks.push({
    type: 'table', widths: [2400, 1400, 4512], header: ['教学环节', '时间', '主要内容'],
    rows: STAGES.map((stage, i) => [`（${CN[i]}）${stage}`, `${stageMinutes[i]}分钟`, summaryRow(stage, byStage[i])]),
  });

  STAGES.forEach((stage, i) => {
    blocks.push(p('JStage', `（${CN[i]}）${stage}（${stageMinutes[i]}分钟）`));
    const list = byStage[i];
    if (!list.length) {
      if (stage === '组织教学') blocks.push(p('JBody', '师生问候，检查出勤，做好课前准备。'));
      if (stage === '布置作业') (homework.length ? homework : ['＿＿＿＿＿＿']).forEach((h, j) => blocks.push(p('JBody', `${j + 1}. ${h}`)));
      return;
    }
    list.forEach((s, j) => {
      const title = slideExtra(s, 'method') || heading(s);
      blocks.push(p('JStep', `（${j + 1}）${title}【PPT 第${pageOf.get(s.id)}页】`));
      blocks.push(...stepLines(s));
    });
    if (stage === '布置作业' && homework.length) homework.forEach((h, j) => blocks.push(p('JBody', `作业${j + 1}：${h}`)));
  });

  blocks.push(p('JItem', { text: '板书设计：', font: 'SimHei' }));
  const board = lines(deckExtra(deck, 'board'));
  const collected = slides.map((s) => slideExtra(s, 'board')).filter(Boolean);
  blocks.push({ type: 'box', lines: board.length ? board : collected.length ? [deck.title, ...collected] : [deck.title, ...slides.filter((_, i) => stages[i] === '讲解新知').map(heading).slice(0, 8)] });

  blocks.push(p('JItem', { text: '教学后记：', font: 'SimHei' }));
  ['1. 教学目标的达成情况：', '2. 学生的反馈与困难：', '3. 下次可以改进的地方：'].forEach((t) => blocks.push(p('JBody', t)));

  return { blocks, minutes: total };
}

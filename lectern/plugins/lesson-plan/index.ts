// The lesson-plan (教案) mod: teaching fields on every slide, the 说明部分 on the
// deck, and a Word export in the course format. Turn it on with
//   LECTERN_PLUGINS=lesson-plan npm run dev

import type { LecternPlugin } from '../../src/core/plugins/api';
import { buildDocx } from './docx';
import { MOD, STAGES, buildLessonPlan } from './plan';

const lessonPlan: LecternPlugin = {
  id: MOD,
  name: '教案 · Lesson plan',
  version: '1.0.0',
  description: 'Adds 教学环节, 教师活动 and 学生活动 to each slide’s key notes, and exports a 教案 in Word in the thirteen-item course format.',
  notesFields: [
    { key: 'stage', label: '教学环节', options: [...STAGES], emptyOption: '自动（按幻灯片类型）', help: 'Which stage of 教学过程 this slide belongs to.' },
    { key: 'method', label: '教学方法', rows: 1, placeholder: '图片导入、领读法、问答法…', help: 'Names the step in 教学过程. Empty uses the slide’s title.' },
    { key: 'teacher', label: '教师活动', rows: 3, placeholder: '教师：同学们看，这是什么？', help: 'One line per turn. Empty uses the script above.' },
    { key: 'student', label: '学生活动', rows: 2, placeholder: '学生：这是山。' },
    { key: 'board', label: '板书', rows: 1, placeholder: '山 shān' },
    { key: 'intent', label: '设计意图', rows: 2, placeholder: 'Optional' },
  ],
  deckFields: [
    { key: 'teacher', label: '试讲人', rows: 1 },
    { key: 'supervisor', label: '指导教师', rows: 1 },
    { key: 'place', label: '教学地点', rows: 1 },
    { key: 'textbook', label: '所用教材', rows: 1, placeholder: '《中文》第一册' },
    { key: 'learners', label: '教学对象', rows: 2, placeholder: '国家、年龄、年级、汉语水平、母语' },
    { key: 'content', label: '教学内容', rows: 2, placeholder: 'Empty uses the lesson title.' },
    { key: 'goalsKnowledge', label: '认知目标', rows: 3, placeholder: 'One goal per line' },
    { key: 'goalsSkill', label: '技能目标', rows: 3, placeholder: 'One goal per line' },
    { key: 'goalsAffect', label: '情感目标', rows: 2, placeholder: 'One goal per line' },
    { key: 'focus', label: '教学重点', rows: 2, placeholder: 'One per line' },
    { key: 'difficulties', label: '教学难点', rows: 2, placeholder: 'One per line' },
    { key: 'aids', label: '教具准备', rows: 1, placeholder: 'PPT课件、生字卡片' },
    { key: 'homework', label: '布置作业', rows: 2, placeholder: 'One task per line' },
    { key: 'board', label: '板书设计', rows: 3, placeholder: 'Empty collects each slide’s 板书.' },
  ],
  exporters: [
    {
      id: 'lesson-plan.docx',
      label: '教案 (Word)',
      description: 'Thirteen-item course format, built from the key notes',
      async run(deck, helpers) {
        const { blocks } = buildLessonPlan(deck, helpers.lesson);
        const data = await buildDocx(blocks, { title: `${deck.title} 教案`, creator: deck.extra?.[MOD]?.teacher });
        const safe = deck.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'lesson';
        return { data, fileName: `${safe} 教案.docx` };
      },
    },
  ],
  draftingHints: 'Key notes may name the teaching method of a slide (for example 图片导入 or 领读法) in the cues.',
};

export default lessonPlan;

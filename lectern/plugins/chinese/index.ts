// The Chinese lessons mod: hanzi and pinyin slides, a word-list starter and a
// presenter key that shows or hides pinyin. Turn it on with
//   LECTERN_PLUGINS=chinese npm run dev

import type { LecternPlugin } from '../../src/core/plugins/api';
import { PINYIN_FLAG, chineseKinds } from './kinds';
import { wordListSource } from './source';

const chinese: LecternPlugin = {
  id: 'chinese',
  name: 'Chinese lessons',
  version: '1.0.0',
  description: 'Character, word-card and sentence slides with pinyin, a word-list starter, and a P key that hides or shows pinyin while you present.',
  kinds: chineseKinds,
  deckSources: [wordListSource],
  toggles: [{ key: 'p', flag: PINYIN_FLAG, label: 'Pinyin', defaultOn: true }],
  draftingHints: [
    'This deck teaches Chinese (华文). Use chinese.characters for the overview of new characters (title 生字),',
    'chinese.word for each new character or word with tone-marked pinyin, and chinese.sentence for sentences to read aloud with their pinyin.',
    'Slides speak to students: never put lesson-plan terms on a slide (no 教学目标, 六要素, 人物/时间/地点 chips).',
    'A story recap is a plain question such as 故事说了什么？ The younger the class, the fewer words per slide and the more pictures.',
    'Write slide text in Chinese. Write key notes in the language the teacher used in the request.',
  ].join(' '),
};

export default chinese;

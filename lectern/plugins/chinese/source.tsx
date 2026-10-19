import { useMemo, useState } from 'react';
import type { DeckDraft, DeckSource, DeckSourceProps } from '../../src/core/plugins/api';
import { type WordEntry, parseWordList } from './pinyin';

const EXAMPLE = `山 shan1 mountain
水 shui3 water
火 huǒ fire
木 mù wood, tree
学生 xué sheng student`;

function buildDraft(title: string, words: WordEntry[], o: { overview: boolean; recall: boolean; minutes: number }): DeckDraft {
  const slides: DeckDraft['slides'] = [
    { kind: 'title', content: { eyebrow: '', title, subtitle: '', presenter: '' }, notes: { script: '同学们好！', minutes: 1 } },
  ];
  if (o.overview) {
    slides.push({
      kind: 'chinese.characters',
      content: { title: '生字', items: words.slice(0, 10).map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin })), oneByOne: true },
      notes: { script: '我们先来认一认今天的生字。', cues: ['领读', '齐读'], minutes: 2 },
    });
  }
  for (const w of words) {
    slides.push({
      kind: 'chinese.word',
      content: { hanzi: w.hanzi, pinyin: w.pinyin, meaning: w.meaning, words: [], example: '', examplePinyin: '', image: '' },
      notes: {
        script: `${w.hanzi}，${w.pinyin}。`,
        keyPoints: [[w.hanzi, w.pinyin, w.meaning].filter(Boolean).join(' · ')],
        cues: ['领读', '开火车读'],
        minutes: o.minutes,
      },
    });
  }
  if (o.recall) {
    slides.push({
      kind: 'recall',
      content: { title: '我们来回忆一下', cards: words.slice(0, 6).map((w) => ({ prompt: `${w.hanzi} 怎么读？`, answer: w.pinyin })) },
      notes: { script: '我们来回忆一下今天学的生字。', minutes: 3 },
    });
  }
  slides.push({ kind: 'title', variant: 'center', content: { eyebrow: '', title: '再见！', subtitle: '', presenter: '' }, notes: { script: '今天就上到这儿。同学们再见！', minutes: 1 } });
  return { title, slides };
}

function WordListPanel({ lessonTitle, onDraft, onCancel }: DeckSourceProps) {
  const [title, setTitle] = useState(lessonTitle ?? '');
  const [text, setText] = useState('');
  const [overview, setOverview] = useState(true);
  const [recall, setRecall] = useState(true);
  const words = useMemo(() => parseWordList(text), [text]);
  const count = words.length + 2 + (overview ? 1 : 0) + (recall ? 1 : 0);
  return (
    <div className="new-deck-grid">
      <div className="new-deck-main">
        <label className="field">
          <span className="field-label">Characters and words</span>
          <textarea
            className="textarea mono-ish"
            rows={11}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'One per line: character, pinyin, meaning\n学 xue2 to study\n学校 xuéxiào | school'}
          />
          <span className="field-help">Tone numbers become tone marks. The meaning is optional.</span>
        </label>
        {!text && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText(EXAMPLE)}>Try an example</button>}
        {words.length > 0 && (
          <div className="outline-preview" aria-label="What was read">
            {words.map((w, i) => <span key={i} className="chip">{w.hanzi} <span className="faint">{w.pinyin}</span></span>)}
          </div>
        )}
      </div>
      <div className="new-deck-side">
        <label className="field">
          <span className="field-label">Deck title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="第一课 生字" />
        </label>
        <label className="switch"><input type="checkbox" checked={overview} onChange={(e) => setOverview(e.target.checked)} /><span>Start with all the characters on one slide</span></label>
        <label className="switch"><input type="checkbox" checked={recall} onChange={(e) => setRecall(e.target.checked)} /><span>End with a recall slide</span></label>
        <p className="faint" style={{ fontSize: 13 }}>Each character gets its own card. Add pictures, words and example sentences in the studio.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 'auto' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!words.length}
            onClick={() => onDraft(buildDraft(title.trim() || '生字', words, { overview, recall, minutes: 1.5 }))}
          >
            Make {count} slides
          </button>
        </div>
      </div>
    </div>
  );
}

export const wordListSource: DeckSource = {
  id: 'chinese.words',
  label: 'Word list',
  description: 'Paste the lesson’s characters with pinyin. Each one becomes a card.',
  icon: 'languages',
  Panel: WordListPanel,
};

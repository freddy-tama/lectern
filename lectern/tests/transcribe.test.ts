// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as notesStatus, POST as postNotes } from '../api/lecture-notes';
import {
  SAMPLE_RATE, encodeWav, frameLevels, isQuiet, loudestWindow, mixToMono, planSections, resample, windowCount,
} from '../src/core/transcribe/audio';
import { exportTranscript, fileName, toSrt, toTxt, toVtt } from '../src/core/transcribe/export';
import { LANGUAGES, guessLanguage, languageName } from '../src/core/transcribe/languages';
import {
  cleanSegments, findMatches, highlightRuns, offsetSegments, paragraphs, segmentAt, segmentsBetween, transcriptText, wordCount,
} from '../src/core/transcribe/segments';
import { clock, lengthLabel, parseClock, srtTime, vttTime } from '../src/core/transcribe/time';
import type { LectureNotes, TranscriptSegment } from '../src/core/transcribe/types';
import { type Lesson, db } from '../src/data/db';
import {
  appendSegments, createRecording, deleteRecording, editSegments, lessonForNow, linkToCourse, linkToLesson, noteFromRecording,
  recordingTitle, recordingsForLesson, searchRecordings,
} from '../src/data/recordings';
import { createCourse, createLesson, deleteCourse, deleteLesson, resetAll } from '../src/data/repo';
import { classNotesBody, makeQuizDeck, stampedTranscript } from '../src/features/recordings/actions';

const seg = (start: number, end: number, text: string): TranscriptSegment => ({ start, end, text });

describe('time formatting', () => {
  it('formats clocks, subtitle stamps and lengths', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(3723)).toBe('1:02:03');
    expect(clock(Number.NaN)).toBe('0:00');
    expect(srtTime(62.345)).toBe('00:01:02,345');
    expect(vttTime(3600.5)).toBe('01:00:00.500');
    expect(lengthLabel(45)).toBe('45 s');
    expect(lengthLabel(720)).toBe('12 min');
    expect(lengthLabel(3900)).toBe('1 h 5 min');
    expect(lengthLabel(7200)).toBe('2 h');
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('75')).toBe(75);
    expect(parseClock('soon')).toBeNull();
  });
});

describe('segments', () => {
  it('cleans recogniser output', () => {
    const out = cleanSegments([
      seg(5, 7, '  second   line '),
      seg(0, Number.NaN, 'First line.'),
      seg(8, 9, '[Music]'),
      seg(9, 10, '...'),
      seg(10, 12, 'Thank you.'),
      seg(12, 13, 'thank you'),
      seg(13, 14, 'Thank you!'),
      seg(14, 30, 'Past the end'),
    ], 20);
    expect(out.map((s) => s.text)).toEqual(['First line.', 'second line', 'Thank you.', 'Past the end']);
    expect(out[0]!.end).toBeLessThanOrEqual(5);
    expect(out[0]!.end).toBeGreaterThan(0);
    expect(out[2]).toMatchObject({ start: 10, end: 14 });
    expect(out[3]!.end).toBe(20);
  });

  it('offsets, groups into paragraphs and finds the playing segment', () => {
    const list = [seg(0, 2, 'One.'), seg(2, 4, 'Two.'), seg(9, 11, 'After a pause.'), seg(11, 13, 'More.')];
    expect(offsetSegments(list, 100)[0]).toEqual(seg(100, 102, 'One.'));
    expect(paragraphs(list).map((p) => p.indexes)).toEqual([[0, 1], [2, 3]]);
    const long = Array.from({ length: 30 }, (_, i) => seg(i * 3, i * 3 + 3, `Sentence ${i}.`));
    expect(paragraphs(long).length).toBeGreaterThan(1);
    expect(segmentAt(list, -1)).toBe(-1);
    expect(segmentAt(list, 0)).toBe(0);
    expect(segmentAt(list, 3)).toBe(1);
    expect(segmentAt(list, 7)).toBe(1);
    expect(segmentAt(list, 50)).toBe(3);
    expect(segmentsBetween(list, 3, 10).map((s) => s.text)).toEqual(['Two.', 'After a pause.']);
    expect(transcriptText(list)).toBe('One. Two.\n\nAfter a pause. More.');
    expect(wordCount(list)).toBe(6);
  });

  it('searches without case and marks matches', () => {
    const list = [seg(0, 2, 'The cell wall. A cell (plant)'), seg(2, 4, 'No match'), seg(4, 6, 'CELL division')];
    const matches = findMatches(list, 'cell');
    expect(matches.map((m) => [m.segment, m.from, m.to])).toEqual([[0, 4, 8], [0, 17, 21], [2, 0, 4]]);
    expect(findMatches(list, '(plant)')).toHaveLength(1);
    expect(findMatches(list, '   ')).toEqual([]);
    expect(highlightRuns('The cell wall', [{ from: 4, to: 8, key: 3 }])).toEqual([{ text: 'The ' }, { text: 'cell', mark: 3 }, { text: ' wall' }]);
  });
});

describe('transcript files', () => {
  const list = [seg(0, 2.5, 'Hello class.'), seg(3, 5, 'Open your books.')];

  it('writes text, SRT and WebVTT', () => {
    expect(toTxt(list, { title: 'Week 1' })).toBe('Week 1\n\n[0:00] Hello class. Open your books.\n');
    expect(toSrt(list)).toBe('1\n00:00:00,000 --> 00:00:02,500\nHello class.\n\n2\n00:00:03,000 --> 00:00:05,000\nOpen your books.\n');
    expect(toVtt(list).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello class.')).toBe(true);
    expect(exportTranscript(list, 'srt').ext).toBe('srt');
    expect(exportTranscript(list, 'txt', 'T').text.startsWith('T\n')).toBe(true);
  });

  it('splits long cues and cleans file names', () => {
    const long = [seg(0, 20, 'one two three four five six seven eight nine ten eleven twelve')];
    const cues = toSrt(long).trim().split('\n\n');
    expect(cues.length).toBe(3);
    expect(cues.at(-1)).toContain('--> 00:00:20,000');
    expect(fileName('Week 3: cells/organs?', 'srt')).toBe('Week 3 cells organs.srt');
    expect(fileName('  ', 'txt')).toBe('transcript.txt');
  });
});

describe('audio helpers', () => {
  const tone = (seconds: number, amp = 0.2, rate = SAMPLE_RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin(i / 5));

  it('mixes down and resamples', () => {
    expect([...mixToMono([Float32Array.from([1, 0.5]), Float32Array.from([0, 0.5])])]).toEqual([0.5, 0.5]);
    const mono = Float32Array.from([0.1, 0.2]);
    expect(mixToMono([mono])).not.toBe(mono);
    expect(resample(new Float32Array(48_000), 48_000, 16_000).length).toBe(16_000);
    expect(resample(Float32Array.from([0, 1, 2, 3]), 2, 1)).toEqual(Float32Array.from([0, 2]));
  });

  it('tells quiet from speech and finds the liveliest stretch', () => {
    expect(isQuiet(new Float32Array(SAMPLE_RATE * 5))).toBe(true);
    expect(isQuiet(tone(5))).toBe(false);
    expect(frameLevels(tone(1)).length).toBe(10);
    const audio = new Float32Array(SAMPLE_RATE * 120);
    audio.set(tone(30), SAMPLE_RATE * 60);
    const win = loudestWindow(audio, { seconds: 30 });
    expect(win.start / SAMPLE_RATE).toBeGreaterThanOrEqual(55);
    expect(win.start / SAMPLE_RATE).toBeLessThanOrEqual(65);
  });

  it('cuts long audio into contiguous sections at quiet moments', () => {
    const audio = tone(600);
    // A quiet gap a little after the 4-minute target.
    audio.fill(0, SAMPLE_RATE * 245, SAMPLE_RATE * 246);
    const sections = planSections(audio, { targetSeconds: 240, searchSeconds: 12 });
    expect(sections[0]!.start).toBe(0);
    expect(sections.at(-1)!.end).toBe(audio.length);
    for (let i = 1; i < sections.length; i++) expect(sections[i]!.start).toBe(sections[i - 1]!.end);
    const cut = sections[0]!.end / SAMPLE_RATE;
    expect(cut).toBeGreaterThanOrEqual(245);
    expect(cut).toBeLessThanOrEqual(246);
    expect(planSections(audio, { startSeconds: 500 })).toEqual([{ start: 500 * SAMPLE_RATE, end: audio.length }]);
    expect(planSections(tone(100))).toHaveLength(1);
  });

  it('counts recogniser windows like its 30-second chunking does', () => {
    expect(windowCount(SAMPLE_RATE * 20)).toBe(1);
    expect(windowCount(SAMPLE_RATE * 30)).toBe(1);
    expect(windowCount(SAMPLE_RATE * 31)).toBe(2);
    expect(windowCount(SAMPLE_RATE * 240)).toBe(12);
  });

  it('encodes 16-bit WAV', () => {
    const wav = new DataView(encodeWav(Float32Array.from([0, 1, -1])));
    expect(wav.byteLength).toBe(44 + 6);
    expect(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3))).toBe('RIFF');
    expect(wav.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(wav.getInt16(46, true)).toBe(0x7fff);
    expect(wav.getInt16(48, true)).toBe(-0x8000);
  });
});

describe('languages', () => {
  it('names codes and guesses from the browser', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('xx')).toBe('XX');
    expect(languageName()).toBe('');
    expect(guessLanguage('fr-CA')).toBe('fr');
    expect(guessLanguage('tlh')).toBe('en');
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });
});

describe('recordings data', () => {
  beforeEach(async () => {
    await resetAll(false);
  });

  const lessonAt = (date: string, time?: string, id = date + (time ?? '')): Lesson => ({ id, courseId: 'c', week: 1, order: 0, title: id, summary: '', date, time, createdAt: 0, updatedAt: 0 });

  it('picks the lesson under way today', () => {
    const now = new Date('2026-10-20T10:30:00');
    expect(lessonForNow([lessonAt('2026-10-19', '10:00')], now)).toBeUndefined();
    expect(lessonForNow([lessonAt('2026-10-20')], now)?.id).toBe('2026-10-20');
    const lessons = [lessonAt('2026-10-20', '09:00'), lessonAt('2026-10-20', '10:15'), lessonAt('2026-10-20', '13:00')];
    expect(lessonForNow(lessons, now)?.time).toBe('10:15');
    expect(lessonForNow(lessons, new Date('2026-10-20T08:00:00'))?.time).toBe('09:00');
  });

  it('makes default titles and links', () => {
    expect(recordingTitle({ lesson: { title: 'Cells' } })).toBe('Cells');
    expect(recordingTitle({ fileName: 'Biology_lecture_3.m4a' })).toBe('Biology lecture 3');
    expect(recordingTitle({ fileName: 'Recording 12.m4a', date: '2026-10-20' })).toBe('Class on Tuesday, Oct 20');
    const lesson = lessonAt('2026-10-21', undefined, 'l1');
    expect(linkToLesson({ date: undefined }, lesson)).toEqual({ lessonId: 'l1', courseId: 'c', date: '2026-10-21' });
    expect(linkToLesson({ date: '2026-10-01' }, lesson)).toEqual({ lessonId: 'l1', courseId: 'c' });
    expect(linkToLesson(undefined, undefined)).toEqual({ lessonId: undefined });
    expect(linkToCourse({ lessonId: 'l1' }, 'other', new Map([['l1', lesson]]))).toEqual({ courseId: 'other', lessonId: undefined });
    expect(linkToCourse({ lessonId: 'l1' }, 'c', new Map([['l1', lesson]]))).toEqual({ courseId: 'c' });
  });

  it('saves transcripts as they come, edits them and searches them', async () => {
    const rec = await createRecording({ title: 'Lecture', audio: 'asset:a1', mime: 'audio/mpeg', size: 10 });
    expect(rec.status).toBe('new');
    await appendSegments(rec.id, [seg(0, 2, 'Photosynthesis makes sugar.'), seg(2, 4, 'Plants need light.')], { transcribedSec: 4 });
    // A resumed run that overlaps replaces from where it starts.
    await appendSegments(rec.id, [seg(2, 4, 'Plants need sunlight.'), seg(4, 6, 'Water too.')], { transcribedSec: 6 });
    let stored = (await db.recordings.get(rec.id))!;
    expect(stored.segments.map((s) => s.text)).toEqual(['Photosynthesis makes sugar.', 'Plants need sunlight.', 'Water too.']);
    expect(stored.transcribedSec).toBe(6);
    await editSegments(rec.id, { 0: '  Photosynthesis   makes glucose. ', 2: '' });
    stored = (await db.recordings.get(rec.id))!;
    expect(stored.segments.map((s) => s.text)).toEqual(['Photosynthesis makes glucose.', 'Plants need sunlight.']);
    expect(searchRecordings([stored], 'glucose sunlight')).toHaveLength(1);
    expect(searchRecordings([stored], 'mitochondria')).toHaveLength(0);
  });

  it('links notes back to the recording and unlinks them when it is deleted', async () => {
    const course = await createCourse({ title: 'Biology' });
    const lesson = await createLesson(course.id, 1, { title: 'Cells', date: '2026-10-20' });
    const rec = await createRecording({ title: 'Cells', courseId: course.id, lessonId: lesson.id, audio: '', mime: 'audio/webm', size: 0 });
    const note = await noteFromRecording(rec, { title: 'Notes', body: 'x', tags: ['lecture'], lesson });
    const saved = (await db.notes.get(note.id))!;
    expect(saved).toMatchObject({ recordingId: rec.id, lessonId: lesson.id, courseId: course.id, date: '2026-10-20', tags: ['lecture'] });
    const undo = await deleteRecording(rec.id);
    expect(await db.recordings.get(rec.id)).toBeUndefined();
    expect((await db.notes.get(note.id))!.recordingId).toBeUndefined();
    await undo();
    expect(await db.recordings.get(rec.id)).toBeDefined();
    expect((await db.notes.get(note.id))!.recordingId).toBe(rec.id);
  });

  it('goes with its course, stays when its lesson is deleted, and clears on reset', async () => {
    const course = await createCourse({ title: 'History' });
    const lesson = await createLesson(course.id, 1, { title: 'Rome' });
    const rec = await createRecording({ title: 'Rome', courseId: course.id, lessonId: lesson.id, audio: '', mime: 'audio/webm', size: 0 });

    const undoLesson = await deleteLesson(lesson.id);
    expect(await db.recordings.get(rec.id)).toMatchObject({ courseId: course.id });
    expect((await db.recordings.get(rec.id))!.lessonId).toBeUndefined();
    await undoLesson();
    expect(await recordingsForLesson(lesson.id)).toHaveLength(1);

    const undoCourse = await deleteCourse(course.id);
    expect(await db.recordings.count()).toBe(0);
    await undoCourse();
    expect(await db.recordings.get(rec.id)).toMatchObject({ lessonId: lesson.id });

    await resetAll(false);
    expect(await db.recordings.count()).toBe(0);
  });
});

describe('class notes', () => {
  const notes: LectureNotes = {
    title: 'Cells',
    summary: 'We looked at cells.',
    keyPoints: ['Cells are the unit of life.', 'Plant cells have walls.'],
    actionItems: ['Read chapter 4 by Friday'],
    questions: [
      { question: 'What do plant cells have?', options: ['Walls', 'Wheels', 'Wings', 'Wires'], correct: 0, explanation: 'A cell wall gives plant cells shape.' },
      { question: 'What is the unit of life?', options: ['Atom', 'Cell', 'Organ', 'Tissue'], correct: 1, explanation: 'Every living thing is made of cells.' },
    ],
  };

  beforeEach(async () => {
    await resetAll(false);
  });

  it('writes a note body with a checklist', () => {
    const body = classNotesBody(notes);
    expect(body).toContain('## Summary\nWe looked at cells.');
    expect(body).toContain('- Plant cells have walls.');
    expect(body).toContain('- [ ] Read chapter 4 by Friday');
    expect(body).toContain('Answer: B) Cell');
    expect(stampedTranscript([seg(0, 2, 'Hi.'), seg(65, 66, 'Later.')])).toBe('[0:00] Hi.\n\n[1:05] Later.');
  });

  it('makes a quiz deck and links it to a lesson without slides', async () => {
    const course = await createCourse({ title: 'Biology' });
    const lesson = await createLesson(course.id, 2, { title: 'Cells' });
    const rec = await createRecording({ title: 'Cells', courseId: course.id, lessonId: lesson.id, audio: '', mime: 'audio/webm', size: 0 });
    const deck = await makeQuizDeck(rec, notes, lesson, course);
    expect(deck.slides.map((s) => s.kind)).toEqual(['title', 'question', 'question', 'summary']);
    expect(deck.slides[2]!.content).toMatchObject({ options: ['Atom', 'Cell', 'Organ', 'Tissue'], correct: 1, answer: 'Every living thing is made of cells.' });
    expect(deck.slides[1]!.notes.script).toContain('A) Walls');
    expect(deck.slides[0]!.content.eyebrow).toBe('Week 2 · Biology');
    expect((await db.lessons.get(lesson.id))!.deckId).toBe(deck.id);

    // The lesson has a deck now, so a second quiz stands alone.
    const second = await makeQuizDeck(rec, notes, (await db.lessons.get(lesson.id))!, course);
    expect(second.lessonId).toBeUndefined();
    expect((await db.lessons.get(lesson.id))!.deckId).toBe(deck.id);
  });
});

describe('class notes route', () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, code: process.env.LECTERN_ACCESS_CODE };
  afterEach(() => {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.code === undefined) delete process.env.LECTERN_ACCESS_CODE; else process.env.LECTERN_ACCESS_CODE = saved.code;
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    postNotes(new Request('http://localhost/api/lecture-notes', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

  it('reports when AI is not set up', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await (await notesStatus()).json()).toMatchObject({ available: false });
    const res = await post({ transcript: 'x'.repeat(100) });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/aren’t set up/);
  });

  it('checks the access code and the transcript before calling the AI', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.LECTERN_ACCESS_CODE = 'open-sesame';
    expect((await post({ transcript: 'x'.repeat(100) })).status).toBe(401);
    const ok = { 'x-lectern-code': 'open-sesame' };
    expect((await post({ transcript: 'too short' }, ok)).status).toBe(400);
    expect((await post({ transcript: 'x'.repeat(300_001) }, ok)).status).toBe(413);
  });
});

describe('recogniser loops', () => {
  it('collapses a phrase repeated four or more times, in any script', async () => {
    const { collapseRepeats } = await import('../src/core/transcribe/segments');
    expect(collapseRepeats('Thank you. Thank you. Thank you. Thank you. Thank you.')).toBe('Thank you.');
    expect(collapseRepeats('我今天開車回家 字幕: 字幕: 字幕: 字幕: 字幕:')).toBe('我今天開車回家 字幕:');
    expect(collapseRepeats('現在結束你不想要我你不想要我你不想要我你不想要我')).toBe('現在結束你不想要我');
    expect(collapseRepeats('no, no, no, stop')).toBe('no, no, no, stop');
    expect(collapseRepeats('吃菜 吃菜')).toBe('吃菜 吃菜');
    expect(collapseRepeats('The rain in Spain stays mainly in the plain.')).toBe('The rain in Spain stays mainly in the plain.');
  });
});

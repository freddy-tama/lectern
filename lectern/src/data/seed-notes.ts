// Sample notes: plans, reflections after class and reminders, linked to the sample lessons and decks.

import type { Lesson, Note } from './db';

const DAY = 86_400_000;

function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, m! - 1, d! + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function buildSeedNotes(today: Date, todayIso: string, lessons: Lesson[]): Note[] {
  const base = today.getTime();
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const dateOf = (id: string) => byId.get(id)?.date ?? todayIso;
  let n = 0;
  const note = (input: Omit<Note, 'createdAt' | 'updatedAt' | 'tags'> & { tags?: string[]; ageHours: number }): Note => {
    const { ageHours, tags = [], ...rest } = input;
    n += 1;
    return { ...rest, tags, createdAt: base - ageHours * 3_600_000 - DAY, updatedAt: base - ageHours * 3_600_000 + n };
  };

  return [
    note({
      id: 'note_earth_w1_1_reflection',
      title: 'How the water cycle lesson went',
      body: [
        'The drop-of-water story worked. Almost everyone could retell the four stages at the end.',
        '',
        '- The 97% salt water number got a real reaction. Keep it early.',
        '- Condensation was the stage most people mixed up with evaporation.',
        '',
        '## Next time',
        '- [x] Add a cold-glass demo for condensation',
        '- [ ] Shorten the quote slide; it slowed things down',
      ].join('\n'),
      tags: ['reflection'],
      courseId: 'course_earth',
      lessonId: 'lesson_earth_w1_1',
      deckId: 'deck_water_cycle',
      date: dateOf('lesson_earth_w1_1'),
      mood: 'great',
      ageHours: 300,
    }),
    note({
      id: 'note_earth_w1_2_reflection',
      title: 'Water stores: ran out of time',
      body: [
        'The groundwater activity took twice as long as planned, so the residence-time table was rushed.',
        '',
        '- Pairs worked better than groups of four.',
        '- Two students were absent. Send them the handout.',
        '',
        '- [ ] Email the handout to the two absent students',
        '- [ ] Move the residence-time table to the start of next lesson',
      ].join('\n'),
      tags: ['reflection', 'follow-up'],
      courseId: 'course_earth',
      lessonId: 'lesson_earth_w1_2',
      date: dateOf('lesson_earth_w1_2'),
      mood: 'rough',
      ageHours: 250,
    }),
    note({
      id: 'note_earth_w3_1_plan',
      title: 'Plan for weather vs. climate',
      body: [
        'Start with the "Was yesterday\'s storm climate change?" question and let them argue before teaching anything.',
        '',
        '## Bring',
        '- [ ] Printed 30-year temperature chart for the town',
        '- [ ] Two thermometers for the window test',
        '- [x] Exit-ticket slips',
        '',
        'Watch the time on the compare slide. It ran long with the other group.',
      ].join('\n'),
      tags: ['planning'],
      courseId: 'course_earth',
      lessonId: 'lesson_earth_w3_1',
      deckId: 'deck_weather_climate',
      date: dateOf('lesson_earth_w3_1'),
      pinned: true,
      ageHours: 30,
    }),
    note({
      id: 'note_earth_slide_compare',
      title: '',
      body: 'Use the local example here: last winter\'s snow day vs. the town\'s average January. It makes the difference click.',
      tags: ['idea'],
      courseId: 'course_earth',
      lessonId: 'lesson_earth_w3_1',
      deckId: 'deck_weather_climate',
      slideId: 's_wv_03',
      ageHours: 28,
    }),
    note({
      id: 'note_earth_lab',
      title: 'Book the computer lab',
      body: 'Climate zones needs laptops for the rainfall maps.\n\n- [ ] Ask the office to book Lab 3\n- [ ] Check the map site works on school Wi-Fi',
      tags: ['admin'],
      courseId: 'course_earth',
      lessonId: 'lesson_earth_w3_2',
      date: shift(dateOf('lesson_earth_w3_2'), -2),
      ageHours: 20,
    }),
    note({
      id: 'note_writing_w1_1_reflection',
      title: 'Main thing first: good energy, mixed rewrites',
      body: [
        'People liked the before-and-after emails. The rewrite exercise showed who still buries the point.',
        '',
        '- Three people asked for more workplace examples.',
        '- The "so what?" test was the most useful tool.',
        '',
        '- [ ] Collect two real emails (anonymised) for week 2',
      ].join('\n'),
      tags: ['reflection'],
      courseId: 'course_writing',
      lessonId: 'lesson_writing_w1_1',
      deckId: 'deck_main_thing_first',
      date: dateOf('lesson_writing_w1_1'),
      mood: 'okay',
      ageHours: 320,
    }),
    note({
      id: 'note_writing_feedback_themes',
      title: 'Feedback themes from the week 2 drafts',
      body: [
        '## What keeps coming up',
        '1. Requests hidden in the last paragraph',
        '2. Subject lines that say "Quick question"',
        '3. Deadlines without a day of the week',
        '',
        'Turn these into the checklist for "Edit Like a Stranger".',
      ].join('\n'),
      tags: ['planning', 'feedback'],
      courseId: 'course_writing',
      lessonId: 'lesson_writing_w3_1',
      ageHours: 60,
    }),
    note({
      id: 'note_creatures_w1_2_plan',
      title: 'Who eats what: prep',
      body: [
        'Keep it moving. Two minutes per activity, then switch.',
        '',
        '- [ ] Print and cut the animal cards',
        '- [ ] Bring the plush fox and rabbit',
        '- [ ] Sorting hoops for plant eaters and meat eaters',
      ].join('\n'),
      tags: ['planning'],
      courseId: 'course_creatures',
      lessonId: 'lesson_creatures_w1_2',
      date: dateOf('lesson_creatures_w1_2'),
      ageHours: 10,
    }),
    note({
      id: 'note_parents_evening',
      title: 'Parents\' evening',
      body: 'Bring the progress summaries for Earth & Climate.\n\n- [ ] Print progress summaries\n- [ ] Pick two pieces of work to show',
      tags: ['meeting'],
      date: shift(todayIso, 8),
      time: '17:00',
      ageHours: 50,
    }),
    note({
      id: 'note_meetings_rehearsal',
      title: 'Talk rehearsal notes',
      body: [
        'First run-through was 24 minutes. Target is 20.',
        '',
        '- Cut one example from the agenda section.',
        '- The chart slide lands best when I pause after the number.',
        '',
        '- [ ] Second run-through with a timer',
      ].join('\n'),
      tags: ['rehearsal'],
      deckId: 'deck_meetings_talk',
      slideId: 's_mt_04',
      date: shift(todayIso, 3),
      time: '12:30',
      ageHours: 5,
    }),
    note({
      id: 'note_ideas_next_term',
      title: 'Ideas for next term',
      body: [
        '- A field trip to the weather station',
        '- Let students build their own climate chart deck',
        '- Swap one lecture for a debate on local flood defences',
      ].join('\n'),
      tags: ['idea'],
      pinned: true,
      ageHours: 120,
    }),
  ];
}

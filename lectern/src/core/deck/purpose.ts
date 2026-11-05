// One wording table per deck purpose. The studio, presenter view, study mode, the handout
// and the New deck dialog all read their purpose-specific text from here.

import type { DeckPurpose } from './types';

export interface PurposeWording {
  /** Heading above the notes panel's one-line help. */
  notesHelp: string;
  /** Label, placeholder and help for the key points list. */
  keyPointsLabel: string;
  keyPointsPlaceholder: string;
  /** The question-and-answer pair under the key points. */
  checkLabel: string;
  checkQuestionPlaceholder: string;
  checkAnswerPlaceholder: string;
  checkQuestionAria: string;
  checkAnswerAria: string;
  /** Presenter view eyebrow over the question ("Ask") and over the key points. */
  askEyebrow: string;
  rememberEyebrow: string;
  /** Study mode: menu name and detail, page eyebrow, and the headings inside it. */
  studyName: string;
  studyDetail: string;
  studyEyebrow: string;
  studyRemember: string;
  studyCheck: string;
  studyRate: string;
  /** Handout: the audience toggle, and the heading of that version. */
  handoutPresenter: string;
  handoutAudience: string;
  handoutAudienceHeading: string;
  handoutCheck: string;
  /** Ideas offered when adding a cue. */
  cueIdeas: string[];
  cuePlaceholder: string;
  /** New deck dialog. */
  newDeckDescription: string;
  topicLabel: string;
  topicPlaceholder: string;
  notesPlaceholder: string;
  /** The people the deck is for, as a plural noun. */
  people: string;
  /** What the AI is told to do for this purpose. */
  aiRules: string;
}

const LESSON: PurposeWording = {
  notesHelp: 'What you’ll say, and what learners should keep. Shown in the presenter view, the teleprompter and Study mode.',
  keyPointsLabel: 'Key points for learners',
  keyPointsPlaceholder: 'One thing to remember',
  checkLabel: 'Check for understanding',
  checkQuestionPlaceholder: 'A question to ask',
  checkAnswerPlaceholder: 'Expected answer',
  checkQuestionAria: 'Check question',
  checkAnswerAria: 'Expected answer',
  askEyebrow: 'Ask',
  rememberEyebrow: 'Learners should remember',
  studyName: 'Study mode',
  studyDetail: 'How a learner sees the deck',
  studyEyebrow: 'Study',
  studyRemember: 'Remember',
  studyCheck: 'Check yourself',
  studyRate: 'How well do you know this?',
  handoutPresenter: 'Presenter',
  handoutAudience: 'Learners',
  handoutAudienceHeading: 'Study notes',
  handoutCheck: 'Check yourself:',
  cueIdeas: ['Pause', 'Ask the room', 'Think, pair, share', 'Show of hands', 'Demo', 'Check the time'],
  cuePlaceholder: 'Pause, Ask the room…',
  newDeckDescription: 'Every slide gets key notes: what to say, and what learners should keep.',
  topicLabel: 'What should the lesson teach?',
  topicPlaceholder: 'Photosynthesis for a Year 7 class: what plants need, what they make, and why it matters for us.',
  notesPlaceholder: '# Lesson title\n\n## First idea\n- A short point\n- Another point\nNotes: what you will say here\n\n## Quick check\nQ: A question?\nA) One  B) Two *',
  people: 'learners',
  aiRules: `This is a lesson. Teach less and go deeper: one idea at a time, looked at closely and checked before moving on.
- Open with a picture or a question about today's content only. Never preview a part this session doesn't cover.
- Before a passage, a video or a demo, show 1-2 questions to look for, and answer them after it.
- Ask about facts first, then meaning: what it says or what happened, then why and what it means. Ask more than one question in each section.
- Before a key moment, show a picture and ask the room to look and predict what happens next.
- Put a check after each main idea. For question slides with choices, set "correct" to the index of the right choice and give a one-sentence reason in "answer".
- Order practice from easy to hard: true or false, or putting events, steps or sentences in order (an order slide) or matching pairs and sorting into groups (a match slide), then fill in the blanks, then retelling or explaining in their own words.
- Ask why, not only what: give some true-or-false statements a reason to pick, and put a named person's claim on a question slide (speaker and claim) for the room to agree or disagree with and say why.
- Never show an answer before the slide that asks for it: not in the opening, a heading, a caption or an earlier slide.
- Never test one fact twice, for example a question on a date and then a true-or-false on the same date.
- keyPoints are what a learner must remember, phrased so they make sense without the slide. checkQuestion and checkAnswer test understanding of that slide.
- Close with takeaways, then at most two follow-up tasks: one to practise what was taught, and one open or preview question about what comes next.
- Keep slides small and the pace quick: about 1-1.5 minutes a slide, and about 1 minute for young learners. A 40-minute lesson has about 25-40 slides.
- Put a task and its answer on separate slides: a task slide with lettered parts and what a good answer includes, then the same task slide with "showAnswers" on and a model answer for each part.
- Show a passage one chunk at a time: one paragraph or a few sentences on a slide, with its question after it.`,
};

const TALK: PurposeWording = {
  notesHelp: 'What you’ll say, and what the audience should take away. Shown in the presenter view, the teleprompter and Review mode.',
  keyPointsLabel: 'Takeaways for the audience',
  keyPointsPlaceholder: 'One thing they should remember',
  checkLabel: 'Question for the audience',
  checkQuestionPlaceholder: 'A question to ask the audience',
  checkAnswerPlaceholder: 'What you hope to hear, or your own answer',
  checkQuestionAria: 'Audience question',
  checkAnswerAria: 'Answer to the audience question',
  askEyebrow: 'Ask the audience',
  rememberEyebrow: 'The audience should remember',
  studyName: 'Review mode',
  studyDetail: 'Read the deck with its takeaways',
  studyEyebrow: 'Review',
  studyRemember: 'Takeaways',
  studyCheck: 'Think about it',
  studyRate: 'How well do you know this?',
  handoutPresenter: 'Presenter',
  handoutAudience: 'Audience',
  handoutAudienceHeading: 'Handout',
  handoutCheck: 'Think about it:',
  cueIdeas: ['Pause', 'Ask the audience', 'Show of hands', 'Tell the story', 'Demo', 'Check the time'],
  cuePlaceholder: 'Pause, Show of hands…',
  newDeckDescription: 'Every slide gets key notes: what to say, and what the audience should take away.',
  topicLabel: 'What is the talk about?',
  topicPlaceholder: 'Why small teams ship faster: three stories, what they have in common, and what to try on Monday.',
  notesPlaceholder: '# Talk title\n\n## First idea\n- A short point\n- Another point\nNotes: what you will say here\n\n## Question for the room\nQ: A question?\nA) One  B) Two *',
  people: 'the audience',
  aiRules: `This is a talk. Give it a story arc: a hook, a few ideas that build on each other, and an ending the audience will remember.
- One idea per slide. Keep slides sparse and visual; the story lives in notes.script.
- Keep the pace brisk: about 0.5-1 minute a slide. A 20-minute talk has about 20-40 slides.
- keyPoints are the takeaways the audience should leave with. checkQuestion is an optional question to put to the audience, and checkAnswer is what you hope to hear or your own answer. Use them on a few slides, not all.
- Change the slide type every one to three slides: quotes, big numbers, images, diagrams and statements give the talk rhythm. Never put four slides of the same type in a row.
- In a talk with parts, end each part with a short recap slide (a summary of two or three points) before the next part starts.
- Open with a picture, a diagram or a striking statement, and bring it back near the end, now seen in the light of the talk.
- Close with the takeaways and a closing line.`,
};

const PITCH: PurposeWording = {
  notesHelp: 'What you’ll say, and what the room should believe by the end. Shown in the presenter view, the teleprompter and Review mode.',
  keyPointsLabel: 'Takeaways for the audience',
  keyPointsPlaceholder: 'One thing they should believe',
  checkLabel: 'Likely question',
  checkQuestionPlaceholder: 'A question they’ll likely ask',
  checkAnswerPlaceholder: 'Your answer',
  checkQuestionAria: 'Likely question',
  checkAnswerAria: 'Your answer',
  askEyebrow: 'They may ask',
  rememberEyebrow: 'They should remember',
  studyName: 'Review mode',
  studyDetail: 'Read the deck with its takeaways',
  studyEyebrow: 'Review',
  studyRemember: 'Takeaways',
  studyCheck: 'Likely question',
  studyRate: 'How well do you know this?',
  handoutPresenter: 'Presenter',
  handoutAudience: 'Audience',
  handoutAudienceHeading: 'Handout',
  handoutCheck: 'Likely question:',
  cueIdeas: ['Pause', 'Make eye contact', 'Show the demo', 'Let the number land', 'Check the time', 'Hand over'],
  cuePlaceholder: 'Pause, Let the number land…',
  newDeckDescription: 'Every slide gets key notes: what to say, what the room should believe, and the question you expect.',
  topicLabel: 'What are you pitching?',
  topicPlaceholder: 'A scheduling app for small clinics: who it is for, why now, the traction so far, and the funding we are asking for.',
  notesPlaceholder: '# Company or product\n\n## The problem\n- Who has it\n- What it costs them\nNotes: what you will say here\n\n## The ask\n- What you need, and what it unlocks',
  people: 'the audience',
  aiRules: `This is a pitch. Follow the order investors expect: what the company does in one line, the problem, the solution, the market and why now, the product, the business model, traction, the competition, the team, and the ask.
- The business model says who pays, how much and how often (a pricing slide fits). Traction is proof that it works: numbers, customers, a demo.
- The competition slide names the alternatives and says why you win, for example on a 2 by 2 diagram with you in the best corner. The team slide shows the people and why they are the ones to do this (a people slide).
- A short pitch may merge the solution and the product, or the market and why now, but keeps the business model, the competition, the team and the ask.
- Lead with the problem in the audience's terms. One claim per slide, each backed by a number or an example from the material.
- Each title states the slide's claim ("Clinics lose 6 hours a week to scheduling"), not its topic ("The problem"). Chart and big-number slides give their source and its year when the material says where the figures come from.
- keyPoints are what the audience should believe after the slide. checkQuestion is a question they will likely ask about the slide and checkAnswer is your answer, short and direct.
- End with a slide that states the ask: the amount, what it buys (where the money goes, or the milestones it reaches), and what it makes possible.
- Do not invent traction, customers or figures. If the material has none, leave that slide to placeholders the presenter can fill, written as plain statements rather than made-up numbers.`,
};

const REPORT: PurposeWording = {
  notesHelp: 'What you’ll say, and what readers should keep. Shown in the presenter view, the teleprompter and Review mode.',
  keyPointsLabel: 'Takeaways for the audience',
  keyPointsPlaceholder: 'One finding or number to keep',
  checkLabel: 'Likely question',
  checkQuestionPlaceholder: 'A question they’ll likely ask',
  checkAnswerPlaceholder: 'The answer, with the evidence',
  checkQuestionAria: 'Likely question',
  checkAnswerAria: 'Answer with evidence',
  askEyebrow: 'They may ask',
  rememberEyebrow: 'The audience should remember',
  studyName: 'Review mode',
  studyDetail: 'Read the deck with its takeaways',
  studyEyebrow: 'Review',
  studyRemember: 'Takeaways',
  studyCheck: 'Likely question',
  studyRate: 'How well do you know this?',
  handoutPresenter: 'Presenter',
  handoutAudience: 'Audience',
  handoutAudienceHeading: 'Handout',
  handoutCheck: 'Likely question:',
  cueIdeas: ['Pause', 'Point to the chart', 'Ask for questions', 'Pass to a colleague', 'Check the time', 'Ask for a decision'],
  cuePlaceholder: 'Pause, Point to the chart…',
  newDeckDescription: 'Every slide gets key notes: what to say, what readers should keep, and the question you expect.',
  topicLabel: 'What is the report about?',
  topicPlaceholder: 'Q3 results for the support team: ticket volume, response times, what changed, and the decisions we need.',
  notesPlaceholder: '# Report title\n\n## Summary\n- The main finding\n- What we need decided\nNotes: what you will say here\n\n## Results\n- 42% faster replies\n- 1,200 tickets closed',
  people: 'the audience',
  aiRules: `This is a report. Lead with the summary: the answer or main finding comes first, then the evidence.
- Use numbers wherever the material has them: big-number, chart and table slides before bullet lists. Say what each number means in notes.script.
- Group slides as summary, findings, analysis, then what happens next.
- Each title states the finding ("Replies got 42% faster after the new rota"), not the topic ("Response times"), most of all on chart, table and big-number slides.
- Chart and big-number slides give their source and its year (where the figures come from) when the material says; tables put it in the caption.
- keyPoints are the findings or figures to keep. checkQuestion is a likely question from the reader and checkAnswer is the answer with its evidence.
- End with the decisions needed and next steps, with owners and dates only if the material gives them.
- Never invent data. Use only figures from the material.`,
};

const TABLE: Record<DeckPurpose, PurposeWording> = { lesson: LESSON, talk: TALK, pitch: PITCH, report: REPORT };

export function wording(purpose: DeckPurpose): PurposeWording {
  return TABLE[purpose] ?? TALK;
}

// Vercel function: turns a lecture transcript into class notes with Claude.
// GET  /api/lecture-notes → { available, model, needsCode }
// POST /api/lecture-notes → { notes } or { error }
//
// The transcript is made in the browser; only its text is sent here, and only when
// someone asks for class notes.
//
// Environment:
//   ANTHROPIC_API_KEY     required for class notes
//   LECTERN_MODEL         optional, defaults to claude-opus-5-5
//   LECTERN_ACCESS_CODE   optional; when set, requests must send it in "x-lectern-code"

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.LECTERN_MODEL || 'claude-opus-5-5';
/** About five hours of speech. Longer transcripts are refused rather than cut silently. */
const MAX_TRANSCRIPT = 300_000;

interface NotesBody {
  transcript?: unknown;
  title?: unknown;
  course?: unknown;
  lesson?: unknown;
  language?: unknown;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'keyPoints', 'actionItems', 'questions'],
  properties: {
    title: { type: 'string', description: 'A short title for what the class covered, under 70 characters.' },
    summary: { type: 'string', description: 'What the class covered, in 3-5 sentences.' },
    keyPoints: { type: 'array', items: { type: 'string' }, description: '4-8 things a learner must remember, each understandable on its own.' },
    actionItems: { type: 'array', items: { type: 'string' }, description: 'Homework, deadlines, things to bring or prepare, and follow-ups the speaker promised. Empty when there are none.' },
    questions: {
      type: 'array',
      description: '3-6 multiple-choice questions that check understanding of the class.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'options', 'correct', 'explanation'],
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, description: 'Exactly four short choices.' },
          correct: { type: 'integer', description: 'Index (0-3) of the right choice.' },
          explanation: { type: 'string', description: 'One sentence on why that choice is right.' },
        },
      },
    },
  },
};

const SYSTEM = `You turn recordings of classes, lectures and talks into class notes for the teacher and the learners.

The transcript was made by speech recognition on the teacher's device. Expect misheard words, missing punctuation and no speaker labels. Where a misheard word is obvious from context, use the intended word. Leave out anything you can't make sense of rather than guessing. Lines start with [m:ss] time markers; you don't need to repeat them.

How to write the notes:
- Use only what was said in the class. Do not add facts, examples or claims of your own.
- summary: what the class covered and why it matters, in 3-5 plain sentences.
- keyPoints: what a learner must remember, each phrased so it makes sense without the recording.
- actionItems: homework, deadlines, things to bring or prepare, and anything the speaker said they would do, phrased as tasks ("Read chapter 4 by Friday"). Leave the list empty when nothing like that was said; never invent tasks.
- questions: multiple-choice questions on the main ideas, each with exactly four plausible choices, one right answer at index "correct", and a one-sentence explanation. Test understanding, not trivia such as times or names of people in the room.
- Classroom management (attendance, "quiet please", technical problems) is not content; leave it out.
- Write in the language the class was taught in.`;

export async function GET() {
  return json({ available: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL, needsCode: Boolean(process.env.LECTERN_ACCESS_CODE) });
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'AI class notes aren’t set up on this server. You can still save the transcript as a note.' }, 503);
  const code = process.env.LECTERN_ACCESS_CODE;
  if (code && request.headers.get('x-lectern-code') !== code) return json({ error: 'Enter the access code for this server to use AI class notes.' }, 401);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 1_500_000) return json({ error: 'The transcript is too long for class notes. Select a part of it and try again.' }, 413);

  let body: NotesBody;
  try {
    body = (await request.json()) as NotesBody;
  } catch {
    return json({ error: 'The request could not be read.' }, 400);
  }
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (transcript.length < 40) return json({ error: 'The transcript is too short to make notes from.' }, 400);
  if (transcript.length > MAX_TRANSCRIPT) return json({ error: 'The transcript is too long for class notes in one go. Select a part of it and try again.' }, 413);
  const title = text(body.title, 200);
  const course = text(body.course, 200);
  const lesson = text(body.lesson, 300);
  const language = text(body.language, 40);

  const client = new Anthropic();
  const user = [
    'Make class notes from this recording.',
    title ? `Recording: ${title}` : '',
    course ? `Course: ${course}` : '',
    lesson ? `Lesson: ${lesson}` : '',
    language ? `Spoken language (detected): ${language}` : '',
    `<transcript>\n${transcript}\n</transcript>`,
  ].filter(Boolean).join('\n\n');

  try {
    // Streamed so a long transcript never hits a request timeout; finalMessage() gathers it.
    const response = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    }).finalMessage();
    if (response.stop_reason === 'refusal') return json({ error: 'The AI declined to make notes from this transcript. You can still save the transcript as a note.' }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'The notes ran too long. Select a shorter part of the transcript and try again.' }, 422);
    // If a fallback model took over mid-answer, only the text after the last switch is the answer.
    const lastSwitch = response.content.map((b) => b.type as string).lastIndexOf('fallback');
    const out = response.content.slice(lastSwitch + 1).map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (!out.trim()) return json({ error: 'The AI returned no notes. Try again.' }, 502);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    const strings = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((s) => text(s, max)).filter(Boolean).slice(0, n) : []);
    const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).flatMap((q) => {
      const o = (q ?? {}) as Record<string, unknown>;
      const question = text(o.question, 400);
      const options = strings(o.options, 4, 200);
      const correct = Number(o.correct);
      if (!question || options.length !== 4 || !Number.isInteger(correct) || correct < 0 || correct > 3) return [];
      return [{ question, options, correct, explanation: text(o.explanation, 400) }];
    }).slice(0, 8);
    const notes = {
      title: text(parsed.title, 120) || title || 'Class notes',
      summary: text(parsed.summary, 2_000),
      keyPoints: strings(parsed.keyPoints, 10, 300),
      actionItems: strings(parsed.actionItems, 12, 300),
      questions,
    };
    if (!notes.summary && !notes.keyPoints.length) return json({ error: 'The AI returned empty notes. Try again.' }, 502);
    return json({ notes });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'The server’s AI key was rejected. Check ANTHROPIC_API_KEY.' }, 500);
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy right now. Wait a minute and try again.' }, 429);
    if (error instanceof Anthropic.BadRequestError) return json({ error: `The AI request was refused: ${error.message}` }, 400);
    if (error instanceof Anthropic.APIError) return json({ error: `The AI service returned an error (${error.status ?? 'network'}). Try again.` }, 502);
    if (error instanceof SyntaxError) return json({ error: 'The AI returned notes that could not be read. Try again.' }, 502);
    return json({ error: 'Something went wrong while making notes. Try again.' }, 500);
  }
}

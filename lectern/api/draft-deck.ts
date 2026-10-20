// Vercel function: drafts a slide deck with key notes from a topic and optional material.
// GET  /api/draft-deck → { available, model, needsCode }
// POST /api/draft-deck → { draft } or { error }
//
// Environment:
//   ANTHROPIC_API_KEY     required for AI drafting
//   LECTERN_MODEL         optional, defaults to claude-opus-5-5
//   LECTERN_ACCESS_CODE   optional; when set, requests must send it in "x-lectern-code"

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.LECTERN_MODEL || 'claude-opus-5-5';
const MAX_MATERIAL = 60_000;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const KIND = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)?$/;

interface CatalogueField {
  key: string;
  type: string;
  label?: string;
  fields?: string[];
}

interface CatalogueKind {
  kind: string;
  label: string;
  description: string;
  fields: CatalogueField[];
}

interface DraftBody {
  topic?: unknown;
  audience?: unknown;
  purpose?: unknown;
  minutes?: unknown;
  material?: unknown;
  title?: unknown;
  kinds?: unknown;
  hints?: unknown;
  /** Answers to the AI's questions and remembered preferences, as { question, answer }. */
  answers?: unknown;
  /** How much goes on a slide: visual, balanced or detailed. */
  density?: unknown;
  /** Pictures from the person's files: { id, name, mime, data (base64) }. */
  pictures?: unknown;
}

interface Picture {
  id: string;
  name: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  data: string;
}

const PICTURE_ID = /^pic\d{1,2}$/;
const PICTURE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

function cleanPictures(raw: unknown): Picture[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).flatMap((p): Picture[] => {
    const o = (p ?? {}) as Record<string, unknown>;
    const id = text(o.id, 8);
    const mime = text(o.mime, 20) as Picture['mime'];
    const data = typeof o.data === 'string' ? o.data : '';
    if (!PICTURE_ID.test(id) || !PICTURE_MIMES.includes(mime) || !data || data.length > 400_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) return [];
    return [{ id, name: text(o.name, 120), mime, data }];
  });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Keeps only well-formed kinds and fields from the client's catalogue. */
function cleanCatalogue(raw: unknown): CatalogueKind[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).flatMap((k): CatalogueKind[] => {
    const kind = text(k?.kind, 60);
    if (!KIND.test(kind) || !Array.isArray(k?.fields)) return [];
    const fields = (k.fields as unknown[]).slice(0, 12).flatMap((f): CatalogueField[] => {
      const o = f as Record<string, unknown>;
      const key = text(o?.key, 40);
      const type = text(o?.type, 20);
      if (!KEY.test(key) || !['text', 'textarea', 'list', 'objects', 'toggle', 'image'].includes(type)) return [];
      const sub = Array.isArray(o.fields) ? (o.fields as unknown[]).map((s) => text(s, 40)).filter((s) => KEY.test(s)).slice(0, 6) : undefined;
      return [{ key, type, label: text(o.label, 60), ...(sub ? { fields: sub } : {}) }];
    });
    return [{ kind, label: text(k.label, 60), description: text(k.description, 240), fields }];
  });
}

/** One JSON-schema variant per slide kind, built from its editable fields. */
function slideSchema(kinds: CatalogueKind[], pictures: Picture[]) {
  const notes = {
    type: 'object',
    additionalProperties: false,
    required: ['script', 'keyPoints', 'cues', 'checkQuestion', 'checkAnswer', 'minutes'],
    properties: {
      script: { type: 'string', description: 'What the presenter says, written as natural speech.' },
      keyPoints: { type: 'array', items: { type: 'string' }, description: '2-4 points the audience must remember. Empty for title and section slides.' },
      cues: { type: 'array', items: { type: 'string' }, description: 'Short delivery reminders such as "Pause for guesses". Often empty.' },
      checkQuestion: { type: 'string', description: 'A question for this slide, as the deck purpose describes, or an empty string.' },
      checkAnswer: { type: 'string', description: 'The answer to that question, or an empty string.' },
      minutes: { type: 'number', description: 'Planned minutes for the slide.' },
    },
  };
  const variants = kinds.map((k) => {
    const properties: Record<string, unknown> = {};
    for (const f of k.fields) {
      if (f.type === 'image') {
        if (pictures.length) properties[f.key] = { type: 'string', enum: ['', ...pictures.map((p) => p.id)], description: 'The id of a provided picture, or an empty string.' };
        continue;
      }
      if (f.type === 'text' || f.type === 'textarea') properties[f.key] = { type: 'string' };
      else if (f.type === 'toggle') properties[f.key] = { type: 'boolean' };
      else if (f.type === 'list') properties[f.key] = { type: 'array', items: { type: 'string' } };
      else if (f.type === 'objects') {
        const sub = f.fields?.length ? f.fields : ['label'];
        properties[f.key] = { type: 'array', items: { type: 'object', additionalProperties: false, required: sub, properties: Object.fromEntries(sub.map((s) => [s, { type: 'string' }])) } };
      }
    }
    if (k.kind === 'question') properties.correct = { type: 'integer', description: 'Index of the correct choice, or -1.' };
    return {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'content', 'notes'],
      properties: {
        kind: { type: 'string', enum: [k.kind] },
        content: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
        notes,
      },
    };
  });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'slides'],
    properties: {
      title: { type: 'string' },
      slides: { type: 'array', items: { anyOf: variants } },
    },
  };
}

const AUDIENCE_RULES: Record<string, string> = {
  young: 'Young learners aged 6-11. At most 3 short points per slide and about 25 words on a slide. Simple words, concrete examples, frequent quick checks. Scripts are short and warm.',
  teen: 'Teenagers aged 12-17. At most 5 points per slide and about 45 words on a slide. Relatable examples; a check for understanding every 8-10 minutes.',
  adult: 'Adults (university, workshops, talks). At most 6 points per slide and about 70 words on a slide. Precise language; examples from work and everyday life.',
};

const PURPOSES = ['lesson', 'talk', 'pitch', 'report'] as const;
type Purpose = (typeof PURPOSES)[number];

const PURPOSE_RULES: Record<Purpose, string> = {
  lesson: `This is a lesson. Teach one idea at a time and check it before moving on.
- Mix explaining and checking: put a question or quick-recall slide after each main idea. For question slides with choices, set "correct" to the index of the right choice and give a one-sentence reason in "answer".
- keyPoints are what a learner must remember, phrased so they make sense without the slide. checkQuestion and checkAnswer test understanding of that slide.
- Close with takeaways and, when it fits, a closing slide of questions to answer before leaving.
- A typical pace is one slide per 2-4 minutes.`,
  talk: `This is a talk. Give it a story arc: a hook, a few ideas that build on each other, and an ending the audience will remember.
- One idea per slide. Keep slides sparse and visual; the story lives in notes.script.
- keyPoints are the takeaways the audience should leave with. checkQuestion is an optional question to put to the audience, and checkAnswer is what you hope to hear or your own answer. Use them on a few slides, not all.
- Use quotes, big numbers and images to give the talk rhythm.
- Close with the takeaways and a closing line.`,
  pitch: `This is a pitch. Follow this order: the problem, the solution, proof that it works (traction, numbers, customers, a demo), the market and why now, the plan, and the ask.
- Lead with the problem in the audience's terms. One claim per slide, each backed by a number or an example from the material.
- keyPoints are what the audience should believe after the slide. checkQuestion is a question they will likely ask about the slide and checkAnswer is your answer, short and direct.
- End with a slide that states the ask: what you want, how much, and what it makes possible.
- Do not invent traction, customers or figures. If the material has none, say what the slide should show in plain words rather than making numbers up.`,
  report: `This is a report. Lead with the summary: the answer or main finding comes first, then the evidence.
- Use numbers wherever the material has them: big-number, chart and table slides before bullet lists. Say what each number means in notes.script.
- Group slides as summary, findings, analysis, then what happens next. Label charts and tables with what they show.
- keyPoints are the findings or figures to keep. checkQuestion is a likely question from the reader and checkAnswer is the answer with its evidence.
- End with the decisions needed and next steps, with owners and dates only if the material gives them.
- Never invent data. Use only figures from the material.`,
};

const DENSITY_RULES: Record<string, string> = {
  visual: 'Mostly pictures, few words: at most 3 very short points or about 20 words on a slide. Prefer statement, image, big-number, diagram and gallery slides over bullet lists. Everything else goes in notes.script. Where a picture would help and none is provided, add the cue "Picture: <what to show>" so the presenter knows what to add.',
  balanced: 'Balanced: short points with visuals; follow the audience limits.',
  detailed: 'Detailed: slides may carry fuller points (up to the audience limit), tables and charts, so the deck also works when read without a presenter. Keep explanations in notes.script.',
};

const PURPOSE_NOUN: Record<Purpose, string> = { lesson: 'teaching slide decks', talk: 'slide decks for talks', pitch: 'pitch decks', report: 'slide decks for reports' };

function systemPrompt(kinds: CatalogueKind[], hints: string, purpose: Purpose, pictures: Picture[]) {
  const catalogue = kinds.map((k) => `- ${k.kind} (${k.label}): ${k.description} Fields: ${k.fields.filter((f) => f.type !== 'image').map((f) => `${f.key} [${f.type}${f.fields ? `: ${f.fields.join(', ')}` : ''}]`).join(', ')}`).join('\n');
  return `You plan ${PURPOSE_NOUN[purpose]}. Every slide has audience-facing content and key notes for the presenter and for people who read the deck on their own.

How to write a deck:
- Slides are what the room sees: short, concrete, scannable. Never put the explanation on the slide. The explanation goes in notes.script.
- notes.script is the presenter's spoken words for that slide, ready to read from a teleprompter: natural sentences, addressed to the audience where it fits, 40-140 words on content slides, 1-3 sentences on title and section slides. Separate beats with a blank line.
- Open with a title slide and usually an agenda. Use section slides to divide longer sessions. Close with takeaways (summary) and, when it fits, a closing slide.
- Mix slide types so the deck has rhythm. For question slides with choices, set "correct" to the index of the right choice and give a one-sentence reason in "answer".
- Use "reveal": true on points or steps that the presenter should build up one at a time.
- Plan the minutes so the slides add up to the session length.
- Facts in the provided material are authoritative; use them as written and do not contradict them. Do not invent statistics, quotes or sources; if you are not sure a figure is right, leave it out.
- Write in the language of the topic and material.
${pictures.length
  ? '- Pictures from the material are attached, each with an id such as "pic1". Put a picture\'s id in an image field where the picture supports the slide; use each picture at most once and leave image fields empty when nothing fits. Never describe a picture you cannot see.'
  : '- Leave image fields out; the presenter adds pictures.'}

What this deck is for:
${PURPOSE_RULES[purpose]}

Slide types (use only these):
${catalogue}${hints ? `\n\nExtra guidance from installed mods:\n${hints}` : ''}`;
}

export async function GET() {
  return json({ available: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL, needsCode: Boolean(process.env.LECTERN_ACCESS_CODE) });
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'AI drafting isn’t set up on this server. Start from your notes instead.' }, 503);
  const code = process.env.LECTERN_ACCESS_CODE;
  if (code && request.headers.get('x-lectern-code') !== code) return json({ error: 'Enter the access code for this server to use AI drafting.' }, 401);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 4_000_000) return json({ error: 'The material is too long. Use fewer files or pictures.' }, 413);

  let body: DraftBody;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return json({ error: 'The request could not be read.' }, 400);
  }
  const topic = text(body.topic, 2_000);
  if (!topic) return json({ error: 'Describe what the deck is about.' }, 400);
  const purpose: Purpose = (PURPOSES as readonly string[]).includes(String(body.purpose)) ? (String(body.purpose) as Purpose) : 'lesson';
  const audience = ['young', 'teen', 'adult'].includes(String(body.audience)) ? String(body.audience) : 'teen';
  const minutes = Math.max(5, Math.min(180, Number(body.minutes) || 40));
  const material = text(body.material, MAX_MATERIAL);
  const title = text(body.title, 200);
  const kinds = cleanCatalogue(body.kinds);
  if (!kinds.length) return json({ error: 'No slide types were sent.' }, 400);
  const hints = text(body.hints, 4_000);
  const pictures = cleanPictures(body.pictures);
  const density = ['visual', 'balanced', 'detailed'].includes(String(body.density)) ? String(body.density) : '';
  const answers = Array.isArray(body.answers)
    ? (body.answers as Record<string, unknown>[]).slice(0, 16).map((a) => ({ q: text(a?.question, 300), a: text(a?.answer, 300) })).filter((a) => a.a)
    : [];

  const client = new Anthropic();
  const user = [
    `Make a ${purpose} deck for a ${minutes}-minute session.`,
    `Audience: ${AUDIENCE_RULES[audience]}`,
    density ? `Words on a slide: ${DENSITY_RULES[density]}` : '',
    `What the deck is about: ${topic}`,
    title ? `Deck title: ${title}` : '',
    answers.length ? `The presenter's answers and preferences (follow them):\n${answers.map((a) => `- ${a.q ? `${a.q} → ` : ''}${a.a}`).join('\n')}` : '',
    material ? `Material to draw from:\n<material>\n${material}\n</material>` : '',
  ].filter(Boolean).join('\n\n');
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: 'text', text: user },
    ...pictures.flatMap((p): Anthropic.Beta.BetaContentBlockParam[] => [
      { type: 'text', text: `Picture ${p.id}${p.name ? ` (${p.name})` : ''}:` },
      { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } },
    ]),
  ];

  try {
    // Streamed so a long draft never hits a request timeout; finalMessage() gathers it.
    const response = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: slideSchema(kinds, pictures) } },
      system: systemPrompt(kinds, hints, purpose, pictures),
      messages: [{ role: 'user', content }],
    }).finalMessage();
    if (response.stop_reason === 'refusal') return json({ error: 'The AI declined to draft this topic. Try rewording it, or start from your notes.' }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'The draft ran too long. Try a shorter session or less material.' }, 422);
    // If a fallback model took over mid-answer, only the text after the last switch is the deck.
    const lastSwitch = response.content.map((b) => b.type as string).lastIndexOf('fallback');
    const out = response.content.slice(lastSwitch + 1).map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (!out.trim()) return json({ error: 'The AI returned no deck. Try again.' }, 502);
    const parsed = JSON.parse(out) as { title: string; slides: { kind: string; content: Record<string, unknown>; notes: Record<string, unknown> }[] };
    const allowed = new Set(kinds.map((k) => k.kind));
    const slides = parsed.slides.filter((s) => allowed.has(s.kind)).map((s) => {
      const n = s.notes ?? {};
      const question = text(n.checkQuestion, 400);
      return {
        kind: s.kind,
        content: s.content ?? {},
        notes: {
          script: text(n.script, 4_000),
          keyPoints: Array.isArray(n.keyPoints) ? n.keyPoints.map((p) => text(p, 300)).filter(Boolean).slice(0, 6) : [],
          cues: Array.isArray(n.cues) ? n.cues.map((p) => text(p, 60)).filter(Boolean).slice(0, 4) : [],
          check: question ? { question, answer: text(n.checkAnswer, 400) } : null,
          minutes: Math.max(0.5, Math.min(30, Number(n.minutes) || 2)),
          links: [],
        },
      };
    });
    if (!slides.length) return json({ error: 'The AI returned an empty deck. Try again.' }, 502);
    return json({ draft: { title: title || text(parsed.title, 200) || 'Untitled deck', minutes, slides } });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'The server’s AI key was rejected. Check ANTHROPIC_API_KEY.' }, 500);
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy right now. Wait a minute and try again.' }, 429);
    if (error instanceof Anthropic.BadRequestError) return json({ error: `The AI request was refused: ${error.message}` }, 400);
    if (error instanceof Anthropic.APIError) return json({ error: `The AI service returned an error (${error.status ?? 'network'}). Try again.` }, 502);
    if (error instanceof SyntaxError) return json({ error: 'The AI returned a deck that could not be read. Try again.' }, 502);
    return json({ error: 'Something went wrong while drafting. Try again.' }, 500);
  }
}

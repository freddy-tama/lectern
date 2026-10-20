// Vercel function: before a deck is drafted from someone's files, the AI reads an excerpt
// and asks a few quick multiple-choice questions whose answers would change the deck.
// GET  /api/deck-questions → { available, needsCode }
// POST /api/deck-questions → { title, topic, purpose, questions } or { error }
//
// Environment: the same as api/draft-deck.ts (ANTHROPIC_API_KEY, LECTERN_MODEL, LECTERN_ACCESS_CODE).

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.LECTERN_MODEL || 'claude-opus-5-5';
const MAX_EXCERPT = 24_000;
const PURPOSES = ['lesson', 'talk', 'pitch', 'report'] as const;
const KEY = /^[a-z][a-z0-9_]{0,30}$/;

interface QuestionsBody {
  brief?: unknown;
  excerpt?: unknown;
  files?: unknown;
  purpose?: unknown;
  audience?: unknown;
  minutes?: unknown;
  density?: unknown;
  pictures?: unknown;
  remembered?: unknown;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'topic', 'purpose', 'questions'],
  properties: {
    title: { type: 'string', description: 'A short deck title, at most 8 words, in the language of the material.' },
    topic: { type: 'string', description: 'One sentence: what the deck is about and what it is for.' },
    purpose: { type: 'string', enum: [...PURPOSES], description: 'The kind of deck that fits the material best.' },
    questions: {
      type: 'array',
      description: 'Zero to four questions.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'question', 'options', 'multiple', 'remember'],
        properties: {
          key: { type: 'string', description: 'A short snake_case id, for example "emphasis" or "tone".' },
          question: { type: 'string', description: 'One short question, at most 14 words.' },
          options: { type: 'array', items: { type: 'string' }, description: '2 to 5 short answers, 1 to 6 words each. Your best guess first.' },
          multiple: { type: 'boolean', description: 'True when several answers can apply together.' },
          remember: { type: 'boolean', description: 'True only for a lasting personal preference that would apply to future decks too.' },
        },
      },
    },
  },
};

const SYSTEM = `You help someone turn their own files into a slide deck. Before the deck is drafted, you may ask a few quick multiple-choice questions. Each answer must clearly change what the deck says or how it is built; if it would not, do not ask.

Rules for questions:
- Ask between 0 and 4. Ask none when the material and the brief already make the deck clear. Fewer is better.
- Never ask about what is already settled: the kind of deck, the audience, the length, how many words go on a slide, or the look. Never ask again about a preference listed as remembered.
- Good subjects: which parts of the material to put first or leave out, what the audience already knows, what the audience should do or decide afterwards, how interactive the session should be, the tone, and how to end.
- Make options concrete and distinct, drawn from the actual material where possible (name the real sections, products or findings). Put your best guess first.
- Set "remember" to true only for a lasting personal preference that applies to future decks as well (tone, interactivity, how to end, humour). Anything about this material is false. Remembered questions use a general key such as "tone", "interaction" or "ending".
- Write the title, topic, questions and options in the language of the brief and the material.

Also suggest a short deck title, a one-sentence topic, and the kind of deck that fits the material best (lesson, talk, pitch or report).`;

export async function GET() {
  return json({ available: Boolean(process.env.ANTHROPIC_API_KEY), needsCode: Boolean(process.env.LECTERN_ACCESS_CODE) });
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'AI isn’t set up on this server.' }, 503);
  const code = process.env.LECTERN_ACCESS_CODE;
  if (code && request.headers.get('x-lectern-code') !== code) return json({ error: 'Enter the access code for this server to use AI.' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > 200_000) return json({ error: 'The request is too large.' }, 413);

  let body: QuestionsBody;
  try {
    body = (await request.json()) as QuestionsBody;
  } catch {
    return json({ error: 'The request could not be read.' }, 400);
  }
  const brief = text(body.brief, 2_000);
  const excerpt = text(body.excerpt, MAX_EXCERPT);
  if (!brief && !excerpt) return json({ error: 'Add a file or describe the deck first.' }, 400);
  const files = Array.isArray(body.files)
    ? (body.files as Record<string, unknown>[]).slice(0, 20).map((f) => `- ${text(f?.name, 120)} (${text(f?.kind, 20)}${Number(f?.words) > 0 ? `, about ${Math.round(Number(f.words))} words` : ''})`).join('\n')
    : '';
  const remembered = Array.isArray(body.remembered)
    ? (body.remembered as Record<string, unknown>[]).slice(0, 16).map((r) => ({ key: text(r?.key, 40), line: `- ${text(r?.question, 200)} → ${text(r?.answer, 200)}` })).filter((r) => r.key)
    : [];
  const purpose = (PURPOSES as readonly string[]).includes(String(body.purpose)) ? String(body.purpose) : 'talk';
  const settings = [
    `Kind of deck chosen: ${purpose}`,
    `Audience: ${['young', 'teen', 'adult'].includes(String(body.audience)) ? String(body.audience) : 'adult'}`,
    `Length: ${Math.max(5, Math.min(180, Number(body.minutes) || 20))} minutes`,
    `Words on a slide: ${['visual', 'balanced', 'detailed'].includes(String(body.density)) ? String(body.density) : 'balanced'}`,
    Number(body.pictures) > 0 ? `Pictures provided: ${Math.round(Number(body.pictures))}` : '',
  ].filter(Boolean).join('\n');

  const user = [
    brief ? `What the person said about the deck:\n${brief}` : 'The person gave no brief; work from the files.',
    `Already settled:\n${settings}`,
    remembered.length ? `Remembered preferences (do not ask about these again):\n${remembered.map((r) => r.line).join('\n')}` : '',
    files ? `Files:\n${files}` : '',
    excerpt ? `Excerpt of the material:\n<material>\n${excerpt}\n</material>` : '',
  ].filter(Boolean).join('\n\n');

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    }).finalMessage();
    if (response.stop_reason === 'refusal') return json({ error: 'The AI declined to read this material.' }, 422);
    const lastSwitch = response.content.map((b) => b.type as string).lastIndexOf('fallback');
    const out = response.content.slice(lastSwitch + 1).map((b) => (b.type === 'text' ? b.text : '')).join('');
    const parsed = JSON.parse(out) as { title?: string; topic?: string; purpose?: string; questions?: Record<string, unknown>[] };
    const known = new Set(remembered.map((r) => r.key));
    const seen = new Set<string>();
    const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).flatMap((q, i) => {
      const question = text(q?.question, 200);
      const options = Array.isArray(q?.options) ? [...new Set((q.options as unknown[]).map((o) => text(o, 80)).filter(Boolean))].slice(0, 5) : [];
      let key = text(q?.key, 40).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      if (!KEY.test(key)) key = `q${i + 1}`;
      if (!question || options.length < 2 || known.has(key) || seen.has(key)) return [];
      seen.add(key);
      return [{ key, question, options, multiple: Boolean(q?.multiple), remember: Boolean(q?.remember) }];
    }).slice(0, 4);
    return json({
      title: text(parsed.title, 120),
      topic: text(parsed.topic, 400),
      purpose: (PURPOSES as readonly string[]).includes(String(parsed.purpose)) ? parsed.purpose : purpose,
      questions,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'The server’s AI key was rejected. Check ANTHROPIC_API_KEY.' }, 500);
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy right now. Wait a minute and try again.' }, 429);
    if (error instanceof Anthropic.APIError) return json({ error: `The AI service returned an error (${error.status ?? 'network'}).` }, 502);
    if (error instanceof SyntaxError) return json({ error: 'The AI’s questions could not be read.' }, 502);
    return json({ error: 'Something went wrong while reading your files.' }, 500);
  }
}

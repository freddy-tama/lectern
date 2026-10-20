// Vercel function: makes a picture for a slide with an image model.
// GET  /api/picture-generate → { available, provider, model, needsCode }
// POST /api/picture-generate { prompt, shape, style } → { image: "data:image/…;base64,…", provider, model, revisedPrompt } or { error }
//
// Claude doesn't make pictures, so this calls a second provider.
//
// Environment:
//   OPENAI_API_KEY          OpenAI's image model (default gpt-image-1-mini)
//   GEMINI_API_KEY          Google's Gemini image model (default gemini-3.1-flash-image), used when there's no OpenAI key
//   LECTERN_IMAGE_PROVIDER  optional: "openai", "gemini" or "off" (picks one when both keys are set)
//   LECTERN_IMAGE_MODEL     optional model id for that provider
//   LECTERN_ACCESS_CODE     optional; when set, requests must send it in "x-lectern-code"

type Provider = 'openai' | 'gemini';
type Shape = 'wide' | 'tall' | 'square';

const DEFAULT_MODEL: Record<Provider, string> = { openai: 'gpt-image-1-mini', gemini: 'gemini-3.1-flash-image' };

function provider(): Provider | null {
  const wanted = (process.env.LECTERN_IMAGE_PROVIDER ?? '').trim().toLowerCase();
  if (wanted === 'off') return null;
  if (wanted === 'openai') return process.env.OPENAI_API_KEY ? 'openai' : null;
  if (wanted === 'gemini') return process.env.GEMINI_API_KEY ? 'gemini' : null;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

const modelFor = (p: Provider) => process.env.LECTERN_IMAGE_MODEL?.trim() || DEFAULT_MODEL[p];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export interface PictureStyle {
  /** "auto" follows the look and audience. */
  kind?: 'auto' | 'photo' | 'illustration' | 'drawing';
  look?: string;
  lookDescription?: string;
  /** The look's background and accent colours, as #RRGGBB. */
  colors?: string[];
  audience?: 'young' | 'teen' | 'adult';
  purpose?: 'lesson' | 'talk' | 'pitch' | 'report';
}

const KIND_STYLE = {
  photo: 'a natural, well-lit photograph',
  illustration: 'a clean flat illustration with simple shapes and soft shading',
  drawing: 'a hand-drawn line drawing with light watercolour washes',
} as const;

const AUDIENCE_STYLE = {
  young: 'It is for children aged 6 to 11: friendly, warm and simple, with clear shapes and nothing frightening.',
  teen: 'It is for teenagers: clear, modern and engaging.',
  adult: 'It is for adults: clear, calm and professional.',
} as const;

/** The full prompt: what to show, then a style that follows the deck's look and audience. */
export function picturePrompt(subject: string, style: PictureStyle = {}): string {
  const audience = style.audience && style.audience in AUDIENCE_STYLE ? style.audience : 'adult';
  const purpose = style.purpose ?? 'talk';
  let kind = style.kind && style.kind !== 'auto' && style.kind in KIND_STYLE ? style.kind : null;
  kind ??= audience === 'young' ? 'illustration' : purpose === 'pitch' || purpose === 'report' ? 'photo' : null;
  const colors = (style.colors ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4);
  const look = text(style.look, 40);
  const lookDescription = text(style.lookDescription, 160);
  return [
    `A picture for a presentation slide: ${subject}`,
    `Style: ${kind ? KIND_STYLE[kind] : 'a clean modern illustration or a natural photograph, whichever shows the subject best'}.`,
    AUDIENCE_STYLE[audience],
    look ? `The slides use a look called "${look}"${lookDescription ? ` (${lookDescription.replace(/\.$/, '')})` : ''}, so the picture should feel at home in it.` : '',
    colors.length ? `Use colours that sit well with the slide colours ${colors.join(', ')}; the first is the slide background.` : '',
    'One clear subject, uncluttered, with some space around it.',
    'No words, letters, numbers, labels, captions, logos or watermarks anywhere in the picture.',
  ].filter(Boolean).join('\n');
}

class GenerateError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

async function readError(res: Response): Promise<{ message: string; code: string }> {
  const body = await res.json().catch(() => ({})) as { error?: { message?: string; code?: string; status?: string } };
  return { message: String(body.error?.message ?? ''), code: String(body.error?.code ?? body.error?.status ?? '') };
}

async function withOpenAI(prompt: string, shape: Shape, model: string) {
  const size = { wide: '1536x1024', tall: '1024x1536', square: '1024x1024' }[shape];
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, size, quality: 'medium', output_format: 'jpeg', output_compression: 86, n: 1 }),
    signal: AbortSignal.timeout(170_000),
  });
  if (!res.ok) {
    const { message, code } = await readError(res);
    if (res.status === 401) throw new GenerateError('The server’s OpenAI key was rejected. Check OPENAI_API_KEY.', 500);
    if (res.status === 429) throw new GenerateError('The picture service is busy or out of credit. Wait a minute and try again.', 429);
    if (code === 'moderation_blocked' || /safety|moderation/i.test(message)) throw new GenerateError('The picture service declined this description. Try describing it differently.', 422);
    throw new GenerateError(`The picture service returned an error (${res.status}). Try again.`);
  }
  const data = await res.json() as { data?: { b64_json?: string; revised_prompt?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new GenerateError('The picture service sent no picture. Try again.');
  return { image: `data:image/jpeg;base64,${b64}`, revisedPrompt: text(data.data?.[0]?.revised_prompt, 2000) };
}

async function withGemini(prompt: string, shape: Shape, model: string) {
  const aspectRatio = { wide: '16:9', tall: '3:4', square: '1:1' }[shape];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': String(process.env.GEMINI_API_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } },
    }),
    signal: AbortSignal.timeout(170_000),
  });
  if (!res.ok) {
    const { message } = await readError(res);
    if (res.status === 400 && /api key/i.test(message)) throw new GenerateError('The server’s Gemini key was rejected. Check GEMINI_API_KEY.', 500);
    if (res.status === 401 || res.status === 403) throw new GenerateError('The server’s Gemini key was rejected. Check GEMINI_API_KEY.', 500);
    if (res.status === 404) throw new GenerateError(`The Gemini model “${model}” wasn’t found. Set LECTERN_IMAGE_MODEL to a current image model.`, 500);
    if (res.status === 429) throw new GenerateError('The picture service is busy or out of credit. Wait a minute and try again.', 429);
    throw new GenerateError(`The picture service returned an error (${res.status}). Try again.`);
  }
  type Part = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } };
  const data = await res.json() as { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  if (data.promptFeedback?.blockReason) throw new GenerateError('The picture service declined this description. Try describing it differently.', 422);
  // Thinking models can send draft pictures first; the last non-thought picture is the answer.
  const parts = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && p.inlineData?.data);
  const picture = parts.at(-1)?.inlineData;
  if (!picture?.data) {
    if (/SAFETY|PROHIBITED|BLOCK/i.test(String(data.candidates?.[0]?.finishReason ?? ''))) throw new GenerateError('The picture service declined this description. Try describing it differently.', 422);
    throw new GenerateError('The picture service sent no picture. Try again.');
  }
  const mime = /^image\/(png|jpeg|webp)$/.test(String(picture.mimeType)) ? picture.mimeType : 'image/png';
  return { image: `data:${mime};base64,${picture.data}`, revisedPrompt: '' };
}

export async function GET() {
  const p = provider();
  return json({ available: Boolean(p), provider: p, model: p ? modelFor(p) : undefined, needsCode: Boolean(process.env.LECTERN_ACCESS_CODE) });
}

export async function POST(request: Request) {
  const p = provider();
  if (!p) return json({ error: 'AI pictures aren’t set up on this server. Search for a picture or upload one instead.' }, 503);
  const code = process.env.LECTERN_ACCESS_CODE;
  if (code && request.headers.get('x-lectern-code') !== code) return json({ error: 'Enter the access code for this server to make AI pictures.' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > 20_000) return json({ error: 'The description is too long.' }, 413);
  let body: { prompt?: unknown; shape?: unknown; style?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'The request could not be read.' }, 400);
  }
  const subject = text(body.prompt, 1_500);
  if (subject.length < 3) return json({ error: 'Describe the picture you want.' }, 400);
  const shape: Shape = (['wide', 'tall', 'square'] as const).find((s) => s === body.shape) ?? 'wide';
  const style = (body.style && typeof body.style === 'object' ? body.style : {}) as PictureStyle;
  const prompt = picturePrompt(subject, style);
  const model = modelFor(p);
  try {
    const out = p === 'openai' ? await withOpenAI(prompt, shape, model) : await withGemini(prompt, shape, model);
    return json({ ...out, provider: p, model });
  } catch (error) {
    if (error instanceof GenerateError) return json({ error: error.message }, error.status);
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return json({ error: 'The picture took too long to make. Try again.' }, 504);
    return json({ error: 'Something went wrong while making the picture. Try again.' }, 500);
  }
}

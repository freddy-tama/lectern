// What AI calls cost, in US dollars and in Lectern's credits. The drafting page shows an
// estimate from these figures, and the server charges each signed-in person's credits by them.
// Prices are list prices per million tokens (Claude: the claude-api reference, cached 2026-10-06;
// pictures: OpenAI's model pages and Google's pricing page, 2026-10-21). Kept apart from React and the
// browser, so the server functions can import it too.

/** One call's tokens for one model. */
export interface CallUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface TokenPrice {
  prefix: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** US dollars per million tokens. Cache writes are the 5-minute rate (1.25× input). Longer prefixes first. */
const PRICES: TokenPrice[] = [
  { prefix: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { prefix: 'claude-opus-5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: 'claude-opus-4', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: 'claude-fable-5', input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { prefix: 'claude-mythos-5', input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { prefix: 'claude-sonnet-5', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { prefix: 'claude-sonnet-4', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { prefix: 'claude-haiku-5-5', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  { prefix: 'claude-haiku-4', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
];

/** A model missing from the table is charged at the dearest rate, so an unknown model never runs free. */
const DEAREST: TokenPrice = PRICES.reduce((a, p) => (p.output > a.output ? p : a));

export function tokenPrice(model: string): TokenPrice | undefined {
  return PRICES.find((p) => model.startsWith(p.prefix));
}

/** The list price of one call in US dollars, or null when the model isn't in the table. */
export function callDollars(u: CallUsage, strict = false): number | null {
  const p = tokenPrice(u.model) ?? (strict ? undefined : DEAREST);
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

// ─── Pictures ──────────────────────────────────────────────────────────────────

/** Picture tokens, as the image services count them. */
export interface PictureUsage {
  model: string;
  textIn: number;
  imageIn: number;
  textOut: number;
  imageOut: number;
}

/**
 * US dollars per million tokens for the image models Lectern calls. Text output includes thinking.
 * `fallback` is charged per picture when the service reports no tokens: a deliberate over-estimate.
 */
const PICTURE_PRICES: { prefix: string; textIn: number; imageIn: number; textOut: number; imageOut: number; fallback: number }[] = [
  { prefix: 'gpt-image-2.5-sunburst', textIn: 5, imageIn: 8, textOut: 0, imageOut: 30, fallback: 0.1 },
  { prefix: 'gpt-image-1-mini', textIn: 2, imageIn: 2.5, textOut: 0, imageOut: 8, fallback: 0.02 },
  { prefix: 'gemini-3.1-flash-image', textIn: 0.5, imageIn: 0.5, textOut: 3, imageOut: 60, fallback: 0.07 },
];

/** What a picture costs when the service reports no usage, or the model isn't in the table: the dearest picture. */
const PICTURE_FALLBACK = Math.max(...PICTURE_PRICES.map((p) => p.fallback));

export function pictureDollars(u: PictureUsage | null, model: string): number {
  const p = PICTURE_PRICES.find((x) => (u?.model ?? model).startsWith(x.prefix));
  if (!p) return PICTURE_FALLBACK;
  if (!u || u.textIn + u.imageIn + u.textOut + u.imageOut === 0) return p.fallback;
  return (u.textIn * p.textIn + u.imageIn * p.imageIn + u.textOut * p.textOut + u.imageOut * p.imageOut) / 1_000_000;
}

// ─── Credits ───────────────────────────────────────────────────────────────────

/** Each new account starts with $20 of AI use, counted as 4000 credits. */
export const START_CREDITS = 4000;
export const DOLLARS_PER_CREDIT = 0.005;

/** Dollars as credits, rounded up to a thousandth so no call is charged nothing. */
export function toCredits(dollars: number): number {
  if (!(dollars > 0)) return 0;
  return Math.ceil(dollars / DOLLARS_PER_CREDIT * 1000) / 1000;
}

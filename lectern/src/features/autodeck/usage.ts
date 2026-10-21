// What AI drafting used: tokens per model from each call's usage, and a rough cost.

import type { TokenTally, UsageByModel } from '../../data/draft-jobs';

/** One call's usage for one model, as the drafting API returns it. */
export interface CallUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** US dollars per million tokens. Cache writes are the 5-minute rate (1.25× input). */
const PRICES: { prefix: string; input: number; output: number; cacheRead: number; cacheWrite: number }[] = [
  { prefix: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { prefix: 'claude-opus-5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: 'claude-opus-4', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: 'claude-fable-5', input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { prefix: 'claude-sonnet-5', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { prefix: 'claude-sonnet-4', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { prefix: 'claude-haiku-5-5', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
];

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Usage from a response body, ignoring anything malformed. */
export function readUsage(raw: unknown): CallUsage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((u): CallUsage[] => {
    const o = (u && typeof u === 'object' ? u : {}) as Record<string, unknown>;
    if (typeof o.model !== 'string' || !o.model) return [];
    return [{ model: o.model.slice(0, 80), input: count(o.input), output: count(o.output), cacheRead: count(o.cacheRead), cacheWrite: count(o.cacheWrite) }];
  });
}

/** Adds one call's usage to a job's totals. */
export function addUsage(totals: UsageByModel, calls: CallUsage[]): UsageByModel {
  const next: UsageByModel = { ...totals };
  for (const c of calls) {
    const t: TokenTally = next[c.model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
    next[c.model] = {
      input: t.input + c.input,
      output: t.output + c.output,
      cacheRead: t.cacheRead + c.cacheRead,
      cacheWrite: t.cacheWrite + c.cacheWrite,
      calls: t.calls + 1,
    };
  }
  return next;
}

export function usageTotals(usage: UsageByModel): TokenTally {
  return Object.values(usage).reduce((a, t) => ({
    input: a.input + t.input,
    output: a.output + t.output,
    cacheRead: a.cacheRead + t.cacheRead,
    cacheWrite: a.cacheWrite + t.cacheWrite,
    calls: a.calls + t.calls,
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 });
}

/** Approximate cost in US dollars, or null when a model's price isn't known. */
export function usageCost(usage: UsageByModel): number | null {
  let total = 0;
  for (const [model, t] of Object.entries(usage)) {
    const p = PRICES.find((x) => model.startsWith(x.prefix));
    if (!p) return null;
    total += (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1_000_000;
  }
  return total;
}

/** "41,200 tokens · about $0.14", for the result page. */
export function usageLine(usage: UsageByModel): string {
  const t = usageTotals(usage);
  const tokens = t.input + t.output + t.cacheRead + t.cacheWrite;
  if (!tokens) return '';
  const cost = usageCost(usage);
  const price = cost === null ? '' : cost < 0.01 ? ' · under $0.01' : ` · about $${cost.toFixed(2)}`;
  return `${tokens.toLocaleString('en-US')} tokens${price}`;
}

/**
 * What a model call cost, from its token counts. Pure. The rates are the
 * Claude API list prices per million tokens; a model this table does not know
 * is priced at the Opus rate, the dearest one in use, so a cap errs on the
 * safe side.
 */
export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };

const RATES: Record<string, Rate> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export const DEFAULT_RATE_MODEL = "claude-opus-5-5";

export function rateFor(model: string): Rate {
  return RATES[model] ?? RATES[DEFAULT_RATE_MODEL];
}

/** US dollars, rounded to a hundredth of a cent. */
export function estimateCostUsd(model: string, u: Usage): number {
  const r = rateFor(model);
  const usd = (u.inputTokens * r.input + u.outputTokens * r.output + u.cacheReadTokens * r.cacheRead + u.cacheWriteTokens * r.cacheWrite) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

/** The SDK's usage block, with the cache counters that may be absent. */
export function usageFrom(sdk: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): Usage {
  return {
    inputTokens: sdk.input_tokens ?? 0,
    outputTokens: sdk.output_tokens ?? 0,
    cacheReadTokens: sdk.cache_read_input_tokens ?? 0,
    cacheWriteTokens: sdk.cache_creation_input_tokens ?? 0,
  };
}

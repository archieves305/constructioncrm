import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

/**
 * The one Anthropic client of the takeoff, made on first use. Without a key
 * the analysis answers 503 and the manual tools work alone; nothing else in
 * the CRM calls the model.
 */
export const AI_MODEL = env.TAKEOFF_AI_MODEL;
export const AI_MAX_USD = Number(env.TAKEOFF_AI_MAX_USD);
export const AI_NOT_CONFIGURED = "AI analysis is not set up on this server";

export function isAiConfigured(): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

export class AiNotConfiguredError extends Error {
  constructor() { super(AI_NOT_CONFIGURED); this.name = "AiNotConfiguredError"; }
}

export class AiCostCapError extends Error {
  constructor(spent: number) { super(`This takeoff has used $${spent.toFixed(2)} of its $${AI_MAX_USD.toFixed(0)} AI allowance — raise TAKEOFF_AI_MAX_USD to continue`); this.name = "AiCostCapError"; }
}

let client: Anthropic | null = null;

export function aiClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
  // 120 s per request and two retries: a regions call on a busy sheet takes ~30 s.
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  return client;
}

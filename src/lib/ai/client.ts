import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

/**
 * The CRM's one Anthropic client, made on first use. Without a key every AI
 * action answers 503 and the manual paths work alone.
 */
export const AI_NOT_CONFIGURED = "AI is not set up on this server";

export function isAiConfigured(): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

export function defaultModel(): string {
  return env.AI_MODEL;
}

export function aiCaps(): { maxSubject: number; maxMonth: number } {
  return { maxSubject: env.AI_MAX_USD_PER_SUBJECT, maxMonth: env.AI_MONTHLY_MAX_USD };
}

/** Every failure of the layer, with the status a route should answer. The message is safe to show. */
export class AiError extends Error {
  constructor(message: string, readonly status: number, readonly code: "not_configured" | "cap" | "refused" | "cut_off" | "schema" | "auth" | "rate_limited" | "upstream") {
    super(message);
    this.name = "AiError";
  }
}

let client: Anthropic | null = null;

export function aiClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new AiError(AI_NOT_CONFIGURED, 503, "not_configured");
  // 120 s per request and two retries (429, 5xx and connection errors): a
  // long document read takes ~30 s.
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  return client;
}

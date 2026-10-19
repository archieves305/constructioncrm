import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ZodType } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { aiCaps, aiClient, AiError, defaultModel } from "./client";
import { inputHash } from "./hash";
import { capMessage, capProblem, monthStart, supportsServerFallback } from "./policy";
import { estimateCostUsd, usageFrom } from "./pricing";
import { UNTRUSTED_RULE } from "./untrusted";

/**
 * One structured call to the model on behalf of a subject (a permit, a
 * correction notice, a takeoff…), recorded as an `AiCall` whichever way it
 * ends.
 *
 * - The answer must match `schema`; anything else is a FAILED call and nothing
 *   is returned — never a partial answer.
 * - The same inputs (purpose, prompt version, model, data) are never paid for
 *   twice on one subject: a recorded OK answer is returned instead.
 * - A subject stops at its dollar allowance, the app at its monthly one.
 * - The call has no tools, and the system prompt always carries the rule that
 *   document text is data (`untrusted.ts`).
 * - What is stored is the parsed output and the counts — never the prompt, the
 *   document or any reasoning.
 */
export type AiCallSpec<T> = {
  subjectType: string;
  subjectId: string;
  purpose: string;
  promptVersion: string;
  schema: ZodType<T>;
  /** Everything the answer depends on besides the prompt version: hashed as the cache key. */
  inputs: unknown;
  system: string;
  content: Anthropic.Beta.BetaMessageParam["content"];
  /** Defaults to AI_MODEL. */
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  userId?: string | null;
};

export type AiCallResult<T> = { output: T; callId: string; cached: boolean; costUsd: number; durationMs: number; model: string };

export async function spentOnSubject(subjectType: string, subjectId: string): Promise<number> {
  const agg = await prisma.aiCall.aggregate({ where: { subjectType, subjectId }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

export async function spentThisMonth(now: Date = new Date()): Promise<number> {
  const agg = await prisma.aiCall.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

export async function runAiCall<T>(spec: AiCallSpec<T>): Promise<AiCallResult<T>> {
  const model = spec.model ?? defaultModel();
  const hash = inputHash({ purpose: spec.purpose, promptVersion: spec.promptVersion, model, inputs: spec.inputs });
  const subject = { subjectType: spec.subjectType, subjectId: spec.subjectId };

  const cached = await prisma.aiCall.findFirst({
    where: { ...subject, purpose: spec.purpose, inputHash: hash, status: "OK", output: { not: Prisma.DbNull } },
    orderBy: { createdAt: "desc" },
    select: { id: true, output: true, model: true },
  });
  if (cached) {
    const parsed = spec.schema.safeParse(cached.output);
    if (parsed.success) return { output: parsed.data, callId: cached.id, cached: true, costUsd: 0, durationMs: 0, model: cached.model };
  }

  const client = aiClient();
  const caps = aiCaps();
  const [spentSubject, spentMonth] = await Promise.all([spentOnSubject(spec.subjectType, spec.subjectId), spentThisMonth()]);
  const problem = capProblem({ spentSubject, spentMonth, maxSubject: caps.maxSubject, maxMonth: caps.maxMonth });
  if (problem) throw new AiError(capMessage(problem), 429, "cap");

  const started = Date.now();
  const base = { ...subject, purpose: spec.purpose, promptVersion: spec.promptVersion, model, inputHash: hash, requestedByUserId: spec.userId ?? null };
  const fail = (data: Partial<Prisma.AiCallUncheckedCreateInput>, message: string) =>
    prisma.aiCall.create({ data: { ...base, ...data, status: "FAILED", error: message.slice(0, 500) } });

  try {
    const res = await client.beta.messages.parse({
      model,
      max_tokens: spec.maxTokens ?? 16_000,
      system: [{ type: "text", text: `${spec.system}\n\n${UNTRUSTED_RULE}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: spec.content }],
      output_config: { effort: spec.effort ?? "high", format: betaZodOutputFormat(spec.schema) },
      // a request the model's safeguards decline is re-run on the fallback the server picks, inside the same call
      ...(supportsServerFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const usage = usageFrom(res.usage);
    // priced on the model that answered: a fallback bills at its own rate
    const costUsd = estimateCostUsd(res.model, usage);
    const durationMs = Date.now() - started;
    const counts = { model: res.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, costUsd, durationMs };

    if (res.stop_reason === "refusal") {
      const why = res.stop_details?.explanation ?? "the model declined";
      await fail(counts, `refused: ${why}`);
      throw new AiError(`The AI declined this request (${why})`, 422, "refused");
    }
    if (res.stop_reason === "max_tokens") {
      await fail(counts, "answer cut off at max_tokens");
      throw new AiError("The AI's answer was cut off", 502, "cut_off");
    }
    // parse() validated against the schema; re-checked so a stored output always matches it
    const checked = res.parsed_output == null ? null : spec.schema.safeParse(res.parsed_output);
    if (!checked?.success) {
      await fail(counts, "answer did not match the schema");
      throw new AiError("The AI's answer did not match what was asked", 502, "schema");
    }
    const row = await prisma.aiCall.create({ data: { ...base, ...counts, status: "OK", output: checked.data as Prisma.InputJsonValue }, select: { id: true } });
    logger.info("ai call", { ...subject, purpose: spec.purpose, ...counts, cacheHit: usage.cacheReadTokens > 0 });
    return { output: checked.data, callId: row.id, cached: false, costUsd, durationMs, model: res.model };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.APIError) {
      await fail({ durationMs: Date.now() - started }, `${err.status ?? "network"}: ${err.message}`);
      logger.warn("ai call failed", { ...subject, purpose: spec.purpose, status: err.status, message: err.message });
      if (err instanceof Anthropic.AuthenticationError) throw new AiError("The AI key on this server was refused", 503, "auth");
      if (err instanceof Anthropic.RateLimitError) throw new AiError("The AI service is busy — try again in a minute", 429, "rate_limited");
      throw new AiError(`The AI service answered ${err.status ?? "with a network error"}`, 502, "upstream");
    }
    throw err;
  }
}

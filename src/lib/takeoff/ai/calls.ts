import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { AI_MAX_USD, AI_MODEL, aiClient, AiCostCapError } from "./client";
import { inputHash } from "./hash";
import { estimateCostUsd, usageFrom } from "./pricing";

/**
 * One structured call to the model on behalf of a takeoff, recorded as a
 * `PlanAiCall` whichever way it ends. The same inputs (purpose, prompt
 * version, model, data) are never paid for twice: a recorded OK answer is
 * returned instead. A takeoff stops at its dollar allowance. What is stored
 * is the parsed output and the counts — never the prompt or any reasoning.
 */
export type AiCallSpec<T> = {
  takeoffId: string;
  planSheetId?: string | null;
  purpose: string;
  promptVersion: string;
  schema: ZodType<T>;
  /** Everything the answer depends on besides the prompt version: hashed as the cache key. */
  inputs: unknown;
  system: string;
  content: Anthropic.MessageParam["content"];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  userId?: string | null;
};

export type AiCallResult<T> = { output: T; callId: string; cached: boolean; costUsd: number; durationMs: number };

export async function spentOnTakeoff(takeoffId: string): Promise<number> {
  const agg = await prisma.planAiCall.aggregate({ where: { takeoffId }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

export async function runAiCall<T>(spec: AiCallSpec<T>): Promise<AiCallResult<T>> {
  const hash = inputHash({ purpose: spec.purpose, promptVersion: spec.promptVersion, model: AI_MODEL, inputs: spec.inputs });
  const cached = await prisma.planAiCall.findFirst({
    where: { takeoffId: spec.takeoffId, purpose: spec.purpose, inputHash: hash, status: "OK", output: { not: Prisma.DbNull } },
    orderBy: { createdAt: "desc" },
    select: { id: true, output: true },
  });
  if (cached) {
    const parsed = spec.schema.safeParse(cached.output);
    if (parsed.success) return { output: parsed.data, callId: cached.id, cached: true, costUsd: 0, durationMs: 0 };
  }
  const spent = await spentOnTakeoff(spec.takeoffId);
  if (spent >= AI_MAX_USD) throw new AiCostCapError(spent);

  const client = aiClient();
  const started = Date.now();
  const base = { takeoffId: spec.takeoffId, planSheetId: spec.planSheetId ?? null, purpose: spec.purpose, promptVersion: spec.promptVersion, model: AI_MODEL, inputHash: hash, requestedByUserId: spec.userId ?? null };
  try {
    const res = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: spec.maxTokens ?? 16_000,
      system: [{ type: "text", text: spec.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: spec.content }],
      output_config: { effort: spec.effort ?? "high", format: zodOutputFormat(spec.schema) },
    });
    const usage = usageFrom(res.usage);
    const costUsd = estimateCostUsd(AI_MODEL, usage);
    const durationMs = Date.now() - started;
    const counts = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, costUsd, durationMs };
    if (res.stop_reason === "refusal") {
      const why = res.stop_details?.explanation ?? "the model declined";
      await prisma.planAiCall.create({ data: { ...base, ...counts, status: "FAILED", error: `refused: ${why}`.slice(0, 500) } });
      throw new Error(`The model declined this request (${why})`);
    }
    if (res.stop_reason === "max_tokens" || res.parsed_output == null) {
      await prisma.planAiCall.create({ data: { ...base, ...counts, status: "FAILED", error: res.stop_reason === "max_tokens" ? "answer cut off at max_tokens" : "answer did not match the schema" } });
      throw new Error(res.stop_reason === "max_tokens" ? "The model's answer was cut off" : "The model's answer did not match what was asked");
    }
    const row = await prisma.planAiCall.create({ data: { ...base, ...counts, status: "OK", output: res.parsed_output as Prisma.InputJsonValue }, select: { id: true } });
    logger.info("takeoff ai call", { takeoffId: spec.takeoffId, purpose: spec.purpose, ...counts, cacheHit: usage.cacheReadTokens > 0 });
    return { output: res.parsed_output, callId: row.id, cached: false, costUsd, durationMs };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const message = `${err.status ?? "network"}: ${err.message}`.slice(0, 500);
      await prisma.planAiCall.create({ data: { ...base, status: "FAILED", error: message, durationMs: Date.now() - started } });
      logger.warn("takeoff ai call failed", { takeoffId: spec.takeoffId, purpose: spec.purpose, status: err.status, message: err.message });
      if (err instanceof Anthropic.AuthenticationError) throw new Error("The AI key on this server was refused");
      if (err instanceof Anthropic.RateLimitError) throw new Error("The AI service is rate-limited — try again in a minute");
      throw new Error(`The AI service answered ${err.status ?? "with a network error"}`);
    }
    throw err;
  }
}

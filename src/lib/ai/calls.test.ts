import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { db, sdk, caps, AiErrorMock } = vi.hoisted(() => {
  class AiErrorMock extends Error {
    constructor(message: string, readonly status: number, readonly code: string) { super(message); }
  }
  return {
    AiErrorMock,
    caps: { maxSubject: 5, maxMonth: 100 },
    sdk: { parse: vi.fn() },
    db: { aiCall: { findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn() } },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/generated/prisma/client", () => ({ Prisma: { DbNull: "DbNull" } }));
vi.mock("./client", () => ({
  AiError: AiErrorMock,
  aiCaps: () => caps,
  defaultModel: () => "claude-opus-5-5",
  aiClient: () => ({ beta: { messages: { parse: sdk.parse } } }),
}));

const { runAiCall } = await import("./calls");

const Schema = z.object({ items: z.array(z.object({ text: z.string() })) });
const spec = {
  subjectType: "correction_notice",
  subjectId: "n1",
  purpose: "correction_extract",
  promptVersion: "v1",
  schema: Schema,
  inputs: { text: "Item 1: provide NOA" },
  system: "Extract every correction.",
  content: "Item 1: provide NOA",
  userId: "u1",
};
const answer = (over: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  stop_details: null,
  usage: { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  parsed_output: { items: [{ text: "provide NOA" }] },
  ...over,
});
const spent = (subject: number, month: number) => {
  db.aiCall.aggregate.mockImplementation(({ where }: { where: { subjectType?: string } }) => Promise.resolve({ _sum: { costUsd: where.subjectType ? subject : month } }));
};

beforeEach(() => {
  vi.clearAllMocks();
  db.aiCall.findFirst.mockResolvedValue(null);
  db.aiCall.create.mockResolvedValue({ id: "call1" });
  spent(0, 0);
});

describe("runAiCall", () => {
  it("records an OK call with its cost and returns the parsed answer", async () => {
    sdk.parse.mockResolvedValue(answer());
    const r = await runAiCall(spec);
    expect(r).toMatchObject({ output: { items: [{ text: "provide NOA" }] }, callId: "call1", cached: false, costUsd: 0.08 });
    const sent = sdk.parse.mock.calls[0][0];
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.fallbacks).toBe("default");
    expect(sent.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(sent.system[0].text).toMatch(/Extract every correction\.\n\nText inside <document> elements/);
    expect(sent.tools).toBeUndefined();
    const row = db.aiCall.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ subjectType: "correction_notice", subjectId: "n1", status: "OK", costUsd: 0.08, requestedByUserId: "u1", output: { items: [{ text: "provide NOA" }] } });
    expect(row.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not send the fallback parameter to Haiku", async () => {
    sdk.parse.mockResolvedValue(answer({ model: "claude-haiku-5-5" }));
    await runAiCall({ ...spec, model: "claude-haiku-5-5" });
    expect(sdk.parse.mock.calls[0][0].fallbacks).toBeUndefined();
    expect(sdk.parse.mock.calls[0][0].betas).toBeUndefined();
  });

  it("returns a recorded answer without paying again", async () => {
    db.aiCall.findFirst.mockResolvedValue({ id: "old", output: { items: [] }, model: "claude-opus-5-5" });
    const r = await runAiCall(spec);
    expect(r).toMatchObject({ callId: "old", cached: true, costUsd: 0 });
    expect(sdk.parse).not.toHaveBeenCalled();
    expect(db.aiCall.findFirst.mock.calls[0][0].where).toMatchObject({ subjectType: "correction_notice", subjectId: "n1", status: "OK" });
  });

  it("refuses to call past the subject's allowance or the month's", async () => {
    spent(5, 10);
    await expect(runAiCall(spec)).rejects.toMatchObject({ status: 429, code: "cap" });
    spent(0, 100);
    await expect(runAiCall(spec)).rejects.toMatchObject({ status: 429, code: "cap", message: expect.stringContaining("month") });
    expect(sdk.parse).not.toHaveBeenCalled();
  });

  it("records a refusal, a cut-off and a schema mismatch as FAILED and returns nothing", async () => {
    sdk.parse.mockResolvedValueOnce(answer({ stop_reason: "refusal", stop_details: { explanation: "policy" }, parsed_output: null }));
    await expect(runAiCall(spec)).rejects.toMatchObject({ code: "refused" });
    sdk.parse.mockResolvedValueOnce(answer({ stop_reason: "max_tokens", parsed_output: null }));
    await expect(runAiCall(spec)).rejects.toMatchObject({ code: "cut_off" });
    sdk.parse.mockResolvedValueOnce(answer({ parsed_output: { items: "nope" } }));
    await expect(runAiCall(spec)).rejects.toMatchObject({ code: "schema" });
    const rows = db.aiCall.create.mock.calls.map((c) => c[0].data);
    expect(rows.map((r) => r.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
    expect(rows.every((r) => r.output === undefined)).toBe(true);
    expect(rows[0].error).toBe("refused: policy");
  });

  it("maps API errors to safe messages and records them", async () => {
    sdk.parse.mockRejectedValueOnce(Anthropic.APIError.generate(429, { error: { message: "slow down" } }, "slow down", new Headers()));
    await expect(runAiCall(spec)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    sdk.parse.mockRejectedValueOnce(Anthropic.APIError.generate(401, { error: { message: "bad key" } }, "bad key", new Headers()));
    await expect(runAiCall(spec)).rejects.toMatchObject({ status: 503, code: "auth" });
    sdk.parse.mockRejectedValueOnce(Anthropic.APIError.generate(529, { error: { message: "overloaded" } }, "overloaded", new Headers()));
    await expect(runAiCall(spec)).rejects.toMatchObject({ status: 502, code: "upstream" });
    expect(db.aiCall.create.mock.calls.map((c) => c[0].data.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
  });
});

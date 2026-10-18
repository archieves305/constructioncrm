import { createHash } from "node:crypto";

/**
 * The cache key of a model call: a hash over everything that went into it
 * (purpose, prompt version, model and the inputs), written with sorted keys
 * so the same request always hashes the same. Reading the same document twice
 * never pays twice.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export function inputHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

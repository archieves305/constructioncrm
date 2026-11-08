import { describe, expect, it } from "vitest";
import { readIdempotencyKey } from "./idempotency";

describe("readIdempotencyKey", () => {
  it("treats a missing header as no key", () => {
    expect(readIdempotencyKey(null)).toEqual({ key: null, valid: true });
    expect(readIdempotencyKey("")).toEqual({ key: null, valid: true });
  });
  it("accepts a UUID and similar keys", () => {
    expect(readIdempotencyKey("3f1c9a2e-7b4d-4e0a-9c1f-2d8e6b5a4c3b")).toEqual({
      key: "3f1c9a2e-7b4d-4e0a-9c1f-2d8e6b5a4c3b",
      valid: true,
    });
    expect(readIdempotencyKey("task:abc.123_x").valid).toBe(true);
  });
  it("refuses short, long or odd keys", () => {
    expect(readIdempotencyKey("short").valid).toBe(false);
    expect(readIdempotencyKey("x".repeat(101)).valid).toBe(false);
    expect(readIdempotencyKey("has space key").valid).toBe(false);
  });
});

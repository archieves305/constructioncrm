import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimitForTests,
  clientIp,
  enforceRateLimit,
  rateLimit,
} from "./index";
import type { NextRequest } from "next/server";

function req(headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost/", { headers }) as unknown as NextRequest;
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetRateLimitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit({ key: "k", limit: 5, windowMs: 60_000 }).ok).toBe(true);
    }
  });

  it("blocks requests over the limit", () => {
    for (let i = 0; i < 5; i++) {
      rateLimit({ key: "k", limit: 5, windowMs: 60_000 });
    }
    const r = rateLimit({ key: "k", limit: 5, windowMs: 60_000 });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    for (let i = 0; i < 5; i++) {
      rateLimit({ key: "k", limit: 5, windowMs: 60_000 });
    }
    expect(rateLimit({ key: "k", limit: 5, windowMs: 60_000 }).ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit({ key: "k", limit: 5, windowMs: 60_000 }).ok).toBe(true);
  });

  it("isolates buckets by key", () => {
    for (let i = 0; i < 5; i++) {
      rateLimit({ key: "a", limit: 5, windowMs: 60_000 });
    }
    expect(rateLimit({ key: "a", limit: 5, windowMs: 60_000 }).ok).toBe(false);
    expect(rateLimit({ key: "b", limit: 5, windowMs: 60_000 }).ok).toBe(true);
  });

  it("decrements remaining on each call", () => {
    expect(rateLimit({ key: "k", limit: 3, windowMs: 60_000 }).remaining).toBe(2);
    expect(rateLimit({ key: "k", limit: 3, windowMs: 60_000 }).remaining).toBe(1);
    expect(rateLimit({ key: "k", limit: 3, windowMs: 60_000 }).remaining).toBe(0);
    expect(rateLimit({ key: "k", limit: 3, windowMs: 60_000 }).ok).toBe(false);
  });

  it("reports resetAt as a future timestamp inside the window", () => {
    const before = Date.now();
    const r = rateLimit({ key: "k", limit: 5, windowMs: 60_000 });
    expect(r.resetAt).toBeGreaterThan(before);
    expect(r.resetAt).toBeLessThanOrEqual(before + 60_000);
  });
});

describe("clientIp", () => {
  it("returns the first hop from x-forwarded-for", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it('returns "unknown" when no IP headers are present', () => {
    expect(clientIp(req())).toBe("unknown");
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("returns null when under the limit", () => {
    const res = enforceRateLimit(req({ "x-forwarded-for": "1.1.1.1" }), {
      name: "t",
      limit: 5,
      windowMs: 60_000,
    });
    expect(res).toBeNull();
  });

  it("returns 429 with Retry-After when over the limit", () => {
    const r = req({ "x-forwarded-for": "1.1.1.1" });
    for (let i = 0; i < 5; i++) {
      enforceRateLimit(r, { name: "t", limit: 5, windowMs: 60_000 });
    }
    const res = enforceRateLimit(r, { name: "t", limit: 5, windowMs: 60_000 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBeTruthy();
    expect(res!.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res!.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("isolates limits by client IP", () => {
    const r1 = req({ "x-forwarded-for": "1.1.1.1" });
    const r2 = req({ "x-forwarded-for": "2.2.2.2" });
    for (let i = 0; i < 5; i++) {
      enforceRateLimit(r1, { name: "t", limit: 5, windowMs: 60_000 });
    }
    expect(enforceRateLimit(r1, { name: "t", limit: 5, windowMs: 60_000 })).not.toBeNull();
    expect(enforceRateLimit(r2, { name: "t", limit: 5, windowMs: 60_000 })).toBeNull();
  });

  it("respects a custom identifier override", () => {
    const r = req();
    for (let i = 0; i < 5; i++) {
      enforceRateLimit(r, {
        name: "t",
        limit: 5,
        windowMs: 60_000,
        identifier: "alice@example.com",
      });
    }
    expect(
      enforceRateLimit(r, {
        name: "t",
        limit: 5,
        windowMs: 60_000,
        identifier: "alice@example.com",
      }),
    ).not.toBeNull();
    expect(
      enforceRateLimit(r, {
        name: "t",
        limit: 5,
        windowMs: 60_000,
        identifier: "bob@example.com",
      }),
    ).toBeNull();
  });

  it("isolates buckets by route name with the same identifier", () => {
    const r = req({ "x-forwarded-for": "1.1.1.1" });
    for (let i = 0; i < 5; i++) {
      enforceRateLimit(r, { name: "auth", limit: 5, windowMs: 60_000 });
    }
    expect(enforceRateLimit(r, { name: "auth", limit: 5, windowMs: 60_000 })).not.toBeNull();
    expect(enforceRateLimit(r, { name: "intake", limit: 5, windowMs: 60_000 })).toBeNull();
  });
});

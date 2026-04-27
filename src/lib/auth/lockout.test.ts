import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetLockoutForTests,
  clearLoginFailures,
  isLockedOut,
  recordLoginFailure,
  LOCKOUT,
} from "./lockout";

describe("lockout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetLockoutForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not lock on first few failures", () => {
    expect(recordLoginFailure("a@b.com").locked).toBe(false);
    expect(recordLoginFailure("a@b.com").locked).toBe(false);
    expect(recordLoginFailure("a@b.com").locked).toBe(false);
    expect(isLockedOut("a@b.com").locked).toBe(false);
  });

  it("locks after the threshold is reached", () => {
    for (let i = 0; i < LOCKOUT.threshold - 1; i++) {
      expect(recordLoginFailure("a@b.com").locked).toBe(false);
    }
    const result = recordLoginFailure("a@b.com");
    expect(result.locked).toBe(true);
    expect(result.until).toBeGreaterThan(Date.now());
    expect(isLockedOut("a@b.com").locked).toBe(true);
  });

  it("unlocks after the duration expires", () => {
    for (let i = 0; i < LOCKOUT.threshold; i++) {
      recordLoginFailure("a@b.com");
    }
    expect(isLockedOut("a@b.com").locked).toBe(true);
    vi.advanceTimersByTime(LOCKOUT.durationMs + 1);
    expect(isLockedOut("a@b.com").locked).toBe(false);
  });

  it("resets the counter after the window passes without reaching threshold", () => {
    recordLoginFailure("a@b.com");
    recordLoginFailure("a@b.com");
    vi.advanceTimersByTime(LOCKOUT.windowMs + 1);
    for (let i = 0; i < LOCKOUT.threshold - 1; i++) {
      expect(recordLoginFailure("a@b.com").locked).toBe(false);
    }
    expect(recordLoginFailure("a@b.com").locked).toBe(true);
  });

  it("clears failures on success", () => {
    for (let i = 0; i < LOCKOUT.threshold - 1; i++) {
      recordLoginFailure("a@b.com");
    }
    clearLoginFailures("a@b.com");
    for (let i = 0; i < LOCKOUT.threshold - 1; i++) {
      expect(recordLoginFailure("a@b.com").locked).toBe(false);
    }
  });

  it("isolates between emails", () => {
    for (let i = 0; i < LOCKOUT.threshold; i++) {
      recordLoginFailure("a@b.com");
    }
    expect(isLockedOut("a@b.com").locked).toBe(true);
    expect(isLockedOut("c@d.com").locked).toBe(false);
  });

  it("treats emails case-insensitively", () => {
    for (let i = 0; i < LOCKOUT.threshold; i++) {
      recordLoginFailure("A@B.com");
    }
    expect(isLockedOut("a@b.COM").locked).toBe(true);
  });
});

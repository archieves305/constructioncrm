import { describe, expect, it } from "vitest";
import { PASSWORD_POLICY, validatePassword } from "./password-policy";

describe("validatePassword", () => {
  it("rejects passwords shorter than the minimum length", () => {
    const r = validatePassword("short");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/12 characters/);
  });

  it("rejects common weak passwords even when length-eligible", () => {
    const r = validatePassword("password1234");
    expect(r.ok).toBe(false);
  });

  it("rejects sequential / dictionary patterns", () => {
    const r = validatePassword("aaaabbbbcccc");
    expect(r.ok).toBe(false);
  });

  it("docks score when the password contains user inputs", () => {
    const password = "violet-stapler-bolt-77-canopy";
    const baseline = validatePassword(password);
    const withInputs = validatePassword(password, [password, "violet-stapler"]);
    expect(withInputs.score).toBeLessThan(baseline.score);
  });

  it("accepts strong passphrases", () => {
    const r = validatePassword("violet-stapler-bolt-77-canopy");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.score).toBeGreaterThanOrEqual(PASSWORD_POLICY.minScore);
  });

  it("accepts strong random-ish passwords", () => {
    const r = validatePassword("X9!fb2#qP*tr5VL");
    expect(r.ok).toBe(true);
  });
});

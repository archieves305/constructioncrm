import { describe, expect, it } from "vitest";
import { NUDGE_COOLDOWN_MS, nudgeCooldownMessage, nudgeCooldownRemainingMs } from "./nudge-policy";

const now = new Date("2026-09-24T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("nudge policy", () => {
  it("allows the first nudge", () => {
    expect(nudgeCooldownRemainingMs([{ type: "NOTE", createdAt: hoursAgo(1) }], now)).toBe(0);
  });
  it("blocks a second nudge inside 24 hours, counting from the latest one", () => {
    const remaining = nudgeCooldownRemainingMs(
      [
        { type: "NUDGED", createdAt: hoursAgo(30) },
        { type: "NUDGED", createdAt: hoursAgo(3) },
      ],
      now,
    );
    expect(remaining).toBe(NUDGE_COOLDOWN_MS - 3 * 3_600_000);
  });
  it("allows again after 24 hours", () => {
    expect(nudgeCooldownRemainingMs([{ type: "NUDGED", createdAt: hoursAgo(25) }], now)).toBe(0);
  });
  it("says how long ago in plain words", () => {
    expect(nudgeCooldownMessage("Frank", NUDGE_COOLDOWN_MS - 3 * 3_600_000)).toBe(
      "Frank was already nudged about this 3 hours ago — give it until tomorrow.",
    );
  });
});

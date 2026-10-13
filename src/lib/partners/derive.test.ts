import { describe, expect, it } from "vitest";
import { daysSince, lastTouchLabel, orgBadges, quietDays, type OrgFacts } from "./derive";

const now = new Date("2026-10-13T15:00:00Z");
const s = { activeQuietDays: 60 };
const base: OrgFacts = { stage: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", lastContactAt: "2026-10-01T00:00:00Z", interactionCount: 4 };

describe("derive", () => {
  it("counts days since a touch, never negative", () => {
    expect(daysSince("2026-10-01T00:00:00Z", now)).toBe(12);
    expect(daysSince("2026-10-14T00:00:00Z", now)).toBe(0);
    expect(daysSince(null, now)).toBeNull();
    expect(quietDays({ createdAt: "2026-09-01T00:00:00Z", lastContactAt: null }, now)).toBe(42);
  });

  it("a fresh TARGET draws no badge; a contacted-stage account with no touches is called out", () => {
    expect(orgBadges({ ...base, stage: "TARGET", interactionCount: 0, lastContactAt: null }, now, s)).toEqual([]);
    expect(orgBadges({ ...base, stage: "CONTACTED", interactionCount: 0, lastContactAt: null }, now, s)[0]).toMatchObject({ key: "never-contacted", tone: "danger" });
  });

  it("quiet after the threshold, not before; never on a parked account", () => {
    expect(orgBadges({ ...base, lastContactAt: "2026-07-01T00:00:00Z" }, now, s).map((b) => b.key)).toContain("quiet");
    expect(orgBadges({ ...base, lastContactAt: "2026-07-01T00:00:00Z" }, now, s)[0]?.label).toBe("Quiet 104 days");
    expect(orgBadges(base, now, s).map((b) => b.key)).not.toContain("quiet");
    expect(orgBadges({ ...base, stage: "DORMANT", lastContactAt: "2026-01-01T00:00:00Z" }, now, s)).toEqual([]);
  });

  it("qualification badges by status and expiry", () => {
    expect(orgBadges({ ...base, qualification: { status: "SUBMITTED", expiresAt: null } }, now, s)[0]?.key).toBe("prequal-pending");
    expect(orgBadges({ ...base, qualification: { status: "APPROVED", expiresAt: "2027-06-01T00:00:00Z" } }, now, s)[0]?.key).toBe("prequalified");
    expect(orgBadges({ ...base, qualification: { status: "APPROVED", expiresAt: "2026-11-01T00:00:00Z" } }, now, s)[0]).toMatchObject({ key: "prequal-expiring", tone: "warning" });
    expect(orgBadges({ ...base, qualification: { status: "APPROVED", expiresAt: "2026-10-01T00:00:00Z" } }, now, s)[0]).toMatchObject({ label: "Prequal expired", tone: "danger" });
    expect(orgBadges({ ...base, qualification: { status: "REJECTED", expiresAt: null } }, now, s)).toEqual([]);
  });

  it("bid and work badges, ordered danger → warning → info → success", () => {
    const badges = orgBadges({ ...base, lastContactAt: "2026-07-01T00:00:00Z", openBidCount: 2, jobCount: 2 }, now, s);
    expect(badges.map((b) => b.key)).toEqual(["quiet", "bidding", "repeat"]);
    expect(orgBadges({ ...base, bidCount: 1 }, now, s)[0]?.key).toBe("first-bid");
    expect(orgBadges({ ...base, awardedCount: 1 }, now, s)[0]?.key).toBe("awarded");
  });

  it("labels the last touch", () => {
    expect(lastTouchLabel(null, now)).toBe("never");
    expect(lastTouchLabel("2026-10-13T10:00:00Z", now)).toBe("today");
    expect(lastTouchLabel("2026-10-12T10:00:00Z", now)).toBe("yesterday");
    expect(lastTouchLabel("2026-10-01T10:00:00Z", now)).toBe("12 d ago");
  });
});

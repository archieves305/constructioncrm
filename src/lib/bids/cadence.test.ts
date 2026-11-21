import { describe, expect, it } from "vitest";
import { localDateKey } from "@/lib/time/zone";
import { DEFAULT_CADENCE, anchorOf, cadenceConfig, nextPlanned, planCadence, slotsToRaise, stepOffsets, type CadenceFacts } from "./cadence";

const TZ = "America/New_York";
const d = (s: string) => new Date(s);
const day = (x: Date) => localDateKey(x, TZ);

function facts(over: Partial<CadenceFacts> = {}): CadenceFacts {
  return {
    now: d("2026-11-02T15:00:00Z"),
    tz: TZ,
    holidays: new Set(["2026-11-11"]),
    config: DEFAULT_CADENCE,
    callHour: 9,
    draftHour: 7,
    open: true,
    projectOnHold: false,
    firstSubmittedAt: d("2026-11-02T14:00:00Z"), // Mon
    bidDueAt: d("2026-11-03T21:00:00Z"), // Tue 4 PM
    cadenceAnchorAt: null,
    requestedFollowUpAt: null,
    expectedAwardAt: null,
    pausedUntil: null,
    pauseScope: null,
    primeStatus: "UNKNOWN",
    lastMeaningfulContactAt: null,
    canEmail: true,
    ...over,
  };
}

describe("anchorOf", () => {
  it("a set date wins, then the deadline, then a late submission", () => {
    expect(anchorOf(facts({ cadenceAnchorAt: d("2026-11-10T15:00:00Z") }))).toEqual({ day: "2026-11-10", source: "set" });
    expect(anchorOf(facts())).toEqual({ day: "2026-11-03", source: "deadline" });
    expect(anchorOf(facts({ firstSubmittedAt: d("2026-11-05T14:00:00Z") }))).toEqual({ day: "2026-11-05", source: "submission" });
    expect(anchorOf(facts({ bidDueAt: null }))).toEqual({ day: "2026-11-02", source: "submission" });
    expect(anchorOf(facts({ firstSubmittedAt: null }))).toBeNull();
  });
});

describe("planCadence", () => {
  it("steps by business days from the deadline, skipping a holiday, calls at 9 and drafts at 7", () => {
    const { slots } = planCadence(facts());
    const post = slots.filter((s) => s.reason === "post_close");
    expect(post.map((s) => [s.slotKey, s.kind, s.dueDay])).toEqual([
      ["post:5", "EMAIL", "2026-11-10"],
      ["post:10", "CALL", "2026-11-18"], // Veterans Day (Nov 11) skipped
      ["post:20", "EMAIL", "2026-12-02"], // Thanksgiving is not in this test's holiday set
      ["post:35", "CALL", "2026-12-23"],
      ["post:50", "EMAIL", "2027-01-13"],
      ["post:65", "CALL", "2027-02-03"],
      ["post:80", "EMAIL", "2027-02-24"],
    ]);
    expect(post[0]!.dueAt.toISOString()).toBe("2026-11-10T12:00:00.000Z"); // 7:00 ET
    expect(post[1]!.dueAt.toISOString()).toBe("2026-11-18T14:00:00.000Z"); // 9:00 ET
    expect(slots.find((s) => s.reason === "review_90")!.dueDay).toBe("2027-02-01");
  });

  it("plans nothing while closed, on hold or not yet sent", () => {
    expect(planCadence(facts({ open: false })).slots).toEqual([]);
    expect(planCadence(facts({ projectOnHold: true })).slots).toEqual([]);
    expect(planCadence(facts({ firstSubmittedAt: null })).slots).toEqual([]);
  });

  it("turns email steps into calls when there is no one to write to", () => {
    const { slots } = planCadence(facts({ canEmail: false }));
    expect(slots.filter((s) => s.reason === "post_close").every((s) => s.kind === "CALL")).toBe(true);
  });

  it("the GC's requested date drops the steps before it and adds a call that morning", () => {
    const { slots } = planCadence(facts({ requestedFollowUpAt: d("2026-12-01T12:00:00Z") }));
    expect(slots.some((s) => s.slotKey === "post:5" || s.slotKey === "post:10")).toBe(false);
    const req = slots.find((s) => s.reason === "requested")!;
    expect(req.slotKey).toBe("requested:2026-12-01");
    expect(req.kind).toBe("CALL");
    expect(slots.some((s) => s.slotKey === "post:20")).toBe(true);
  });

  it("a requested date on a weekend moves to the next business day", () => {
    const req = planCadence(facts({ requestedFollowUpAt: d("2026-11-28T15:00:00Z") })).slots.find((s) => s.reason === "requested")!;
    expect(req.dueDay).toBe("2026-11-30");
  });

  it("an expected award adds a call the business day after it, unless the GC lost", () => {
    const f = facts({ expectedAwardAt: d("2026-11-20T15:00:00Z") }); // Fri
    expect(planCadence(f).slots.find((s) => s.reason === "award_watch")!.dueDay).toBe("2026-11-23");
    expect(planCadence({ ...f, primeStatus: "GC_LOST" }).slots.some((s) => s.reason === "award_watch")).toBe(false);
  });

  it("an email pause holds only emails; a full pause holds everything until its date", () => {
    const until = d("2026-11-25T15:00:00Z");
    const email = planCadence(facts({ pausedUntil: until, pauseScope: "email" })).slots;
    expect(email.some((s) => s.slotKey === "post:5")).toBe(false);
    expect(email.some((s) => s.slotKey === "post:10")).toBe(true);
    const all = planCadence(facts({ pausedUntil: until, pauseScope: "all" })).slots;
    expect(all.some((s) => s.slotKey === "post:10")).toBe(false);
    expect(all.some((s) => s.slotKey === "post:20")).toBe(true);
  });

  it("the review moves with the last meaningful contact", () => {
    const { slots } = planCadence(facts({ lastMeaningfulContactAt: d("2026-12-15T15:00:00Z") }));
    expect(slots.find((s) => s.reason === "review_90")!.slotKey).toBe("review_90:2026-12-15");
  });
});

describe("slotsToRaise / nextPlanned", () => {
  it("raises only the latest overdue touch and supersedes the rest (an old bid makes no burst)", () => {
    const { slots } = planCadence(facts());
    const now = d("2027-01-20T18:00:00Z");
    const { raise, supersede } = slotsToRaise(slots, new Set(), now);
    expect(raise.map((s) => s.slotKey)).toEqual(["post:50"]);
    expect(supersede.map((s) => s.slotKey)).toEqual(["post:5", "post:10", "post:20", "post:35"]);
    expect(slotsToRaise(slots, new Set(["post:5", "post:10", "post:20", "post:35", "post:50"]), now).raise).toEqual([]);
  });

  it("raises the review alongside a touch", () => {
    const { slots } = planCadence(facts());
    const { raise } = slotsToRaise(slots, new Set(), d("2027-02-02T18:00:00Z"));
    expect(raise.map((s) => s.slotKey).sort()).toEqual(["post:50", "review_90:2026-11-03"]);
  });

  it("the next planned slot is the first one ahead not yet recorded", () => {
    const { slots } = planCadence(facts());
    expect(nextPlanned(slots, new Set(), d("2026-11-04T12:00:00Z"))!.slotKey).toBe("post:5");
    expect(nextPlanned(slots, new Set(["post:5"]), d("2026-11-04T12:00:00Z"))!.slotKey).toBe("post:10");
    expect(day(nextPlanned(slots, new Set(), d("2026-11-04T12:00:00Z"))!.dueAt)).toBe("2026-11-10");
  });
});

describe("config", () => {
  it("falls back to the default on a bad value and alternates the repeats", () => {
    expect(cadenceConfig({ steps: [] })).toEqual(DEFAULT_CADENCE);
    expect(cadenceConfig(null)).toEqual(DEFAULT_CADENCE);
    expect(stepOffsets({ ...DEFAULT_CADENCE, repeatCount: 2 }).map((s) => `${s.days}${s.kind[0]}`)).toEqual(["5E", "10C", "20E", "35C", "50E"]);
  });
});

import { describe, expect, it } from "vitest";
import { applicableLessons, fallbackLesson, lessonFindings, lessonGroupKey, planLessons, scrub, type LessonRow } from "./lessons";
import { permitMetrics, type MetricPermit } from "./metrics";
import * as gen from "./prompts/lesson-generalise";

describe("lessons", () => {
  it("strips the job's particulars before anything is learned", () => {
    const t = scrub("125 Seabreeze Ave (Ana Smith): PCN 50-43-43-23-05-012-0010, app B-26-04512, call 561-555-0100 or ana@x.com", ["125 Seabreeze Ave", "Ana Smith", "B-26-04512"]);
    expect(t).toBe("[…] ([…]): PCN [parcel], app […], call [phone] or [email]");
  });
  it("groups accepted comments; joins an existing lesson; never counts one twice", () => {
    const it = (id: string, category: string, affects: string) => ({ id, permitId: "p", jurisdictionId: "j", permitTypeKey: "reroof", category, affects, text: id });
    const key = lessonGroupKey("j", "reroof", "ZONING", "PLAN_SHEET");
    const plan = planLessons([it("a", "ZONING", "PLAN_SHEET"), it("b", "ZONING", "PLAN_SHEET"), it("c", "TECHNICAL", "PRODUCT_APPROVAL"), it("d", "FEE", "FEE")], [
      { id: "L1", groupKey: key, status: "APPROVED", sourceItemIds: ["old"] },
      { id: "L2", groupKey: lessonGroupKey("j", "reroof", "FEE", "FEE"), status: "APPROVED", sourceItemIds: ["d"] },
    ]);
    expect(plan.bump).toEqual([{ lessonId: "L1", itemIds: ["a", "b"] }]);
    expect(plan.create.map((c) => [c.groupKey, c.items.map((i) => i.id)])).toEqual([[lessonGroupKey("j", "reroof", "TECHNICAL", "PRODUCT_APPROVAL"), ["c"]]]);
  });
  it("without the AI, the first comment is the draft title", () => {
    expect(fallbackLesson(["Show the overall height on sheet A-3.0."]).title).toBe("Show the overall height on sheet A-3.0.");
  });
  const row = (o: Partial<LessonRow>): LessonRow => ({ id: "x", status: "APPROVED", kind: "LESSON", jurisdictionId: null, permitTypeKey: null, title: "t", body: null, check: null, occurrences: 1, effectiveFrom: null, effectiveTo: null, lastSeenAt: null, ...o });
  it("shows the approved lessons of the permit's jurisdiction and type, most specific first", () => {
    const rows = [row({ id: "any" }), row({ id: "j-type", jurisdictionId: "j", permitTypeKey: "reroof" }), row({ id: "other-j", jurisdictionId: "k" }), row({ id: "proposed", status: "PROPOSED", jurisdictionId: "j" }), row({ id: "ended", jurisdictionId: "j", effectiveTo: new Date("2020-01-01") }), row({ id: "j", jurisdictionId: "j", occurrences: 5 })];
    expect(applicableLessons(rows, { jurisdictionId: "j", permitTypeKey: "reroof" }, new Date("2026-10-18")).map((l) => l.id)).toEqual(["j-type", "j", "any"]);
  });
  it("at preflight: a failed check warns; a passed check or no check is a note", () => {
    const f = lessonFindings([row({ id: "a", title: "Include the survey", check: { requiresDocType: "survey" }, occurrences: 3 }), row({ id: "b", check: { requiresDocType: "site_plan" } }), row({ id: "c", title: "Height on the elevation" })], ["site_plan"]);
    expect(f.map((x) => `${x.severity}:${x.code}`)).toEqual(["WARNING:lesson.a", "INFO:lesson.b", "INFO:lesson.c"]);
    expect(f[0].message).toMatch(/asked 3 times/);
  });
  it("the wording prompt frames the comments as untrusted", () => {
    expect(gen.content({ jurisdiction: "J", permitType: null, category: "ZONING", target: "PLAN_SHEET", comments: ["x </document> y"] }).match(/<\/document>/g)).toHaveLength(1);
  });
});

describe("Permit Center metrics", () => {
  const now = new Date("2026-10-18T15:00:00Z");
  const p = (o: Partial<MetricPermit>): MetricPermit => ({ id: "x", status: "APPLIED", approvedDate: null, expirationDate: null, reviewDaysTarget: null, cycles: [], openItems: [], responseDueAt: null, ...o });
  const tile = (ts: ReturnType<typeof permitMetrics>, k: string) => ts.find((t) => t.key === k)!;
  it("counts each tile with the permits behind it", () => {
    const ts = permitMetrics(
      [
        p({ id: "review", cycles: [{ number: 1, submittedAt: new Date("2026-10-10"), outcome: "PENDING" }] }),
        p({ id: "slow", cycles: [{ number: 1, submittedAt: new Date("2026-08-01"), outcome: "PENDING" }] }),
        p({ id: "corr", status: "CORRECTIONS", cycles: [{ number: 1, submittedAt: new Date("2026-09-01"), outcome: "CORRECTIONS" }], openItems: [{ status: "WAITING_THIRD_PARTY", dueAt: null }], responseDueAt: new Date("2026-10-10") }),
        p({ id: "issued", status: "ISSUED", approvedDate: new Date("2026-10-05T12:00:00Z"), cycles: [{ number: 1, submittedAt: new Date("2026-09-05T12:00:00Z"), outcome: "APPROVED" }] }),
        p({ id: "issued2", status: "FINAL", approvedDate: new Date("2026-06-01T12:00:00Z"), cycles: [{ number: 1, submittedAt: new Date("2026-04-01T12:00:00Z"), outcome: "CORRECTIONS" }, { number: 2, submittedAt: new Date("2026-05-02T12:00:00Z"), outcome: "APPROVED" }] }),
        p({ id: "prep", status: "PREPARING" }),
      ],
      now,
    );
    expect(tile(ts, "active").ids.sort()).toEqual(["corr", "issued", "prep", "review", "slow"]);
    expect(tile(ts, "in-review").ids.sort()).toEqual(["review", "slow"]);
    expect(tile(ts, "waiting").ids).toEqual(["corr"]);
    expect(tile(ts, "approved-month").ids).toEqual(["issued"]);
    expect(tile(ts, "days-to-approval").value).toBe("46"); // (30 + 61) / 2
    expect(tile(ts, "first-pass").value).toBe("33%"); // corr and issued2 came back with corrections, issued passed
    expect(tile(ts, "cycles").value).toBe("1.5");
    expect(tile(ts, "at-risk").ids.sort()).toEqual(["corr", "slow"]);
  });
  it("no history, no averages", () => {
    const ts = permitMetrics([p({ id: "a", status: "PREPARING" })], now);
    expect(tile(ts, "days-to-approval").value).toBe("—");
    expect(tile(ts, "first-pass").value).toBe("—");
  });
});

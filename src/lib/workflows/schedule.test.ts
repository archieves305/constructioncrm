import { describe, expect, it } from "vitest";
import { activationDueAt, addBusinessDaysFrom, initialDueAt, recomputeAfterAnchorChange, recomputeAfterTargetStartChange } from "./schedule";

// Fri 2026-10-02 10:00 local.
const fri = new Date(2026, 9, 2, 10, 0, 0);

describe("addBusinessDaysFrom", () => {
  it("skips weekends forwards and backwards, and rolls a weekend start forward for n = 0", () => {
    expect(addBusinessDaysFrom(fri, 1).getDate()).toBe(5); // Mon
    expect(addBusinessDaysFrom(fri, 3).getDate()).toBe(7); // Wed
    expect(addBusinessDaysFrom(new Date(2026, 9, 7), -3).getDate()).toBe(2); // Wed → Fri
    expect(addBusinessDaysFrom(new Date(2026, 9, 3), 0).getDate()).toBe(5); // Sat → Mon
  });

  it("honours an injected business-day predicate", () => {
    const noMonday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6 && d.getDay() !== 1;
    expect(addBusinessDaysFrom(fri, 1, noMonday).getDate()).toBe(6); // Tue
  });
});

describe("initialDueAt", () => {
  const ctx = { subjectCreatedAt: new Date(2026, 8, 1), appliedAt: fri, targetStartDate: null };

  it("JOB_CREATED counts from the later of job creation and the apply, at 17:00", () => {
    const d = initialDueAt({ anchor: "JOB_CREATED", dueOffsetBusinessDays: 1 }, ctx)!;
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(17);
  });

  it("TARGET_START is null until the job has one, then supports negative offsets", () => {
    const t = { anchor: "TARGET_START" as const, dueOffsetBusinessDays: -2 };
    expect(initialDueAt(t, ctx)).toBeNull();
    const d = initialDueAt(t, { ...ctx, targetStartDate: new Date(2026, 9, 7) })!;
    expect(d.getDate()).toBe(5);
  });

  it("predecessor-anchored tasks have no date until activation", () => {
    expect(initialDueAt({ anchor: "PREDECESSOR", dueOffsetBusinessDays: 2 }, ctx)).toBeNull();
    expect(initialDueAt({ anchor: "PHASE_START", dueOffsetBusinessDays: 2 }, ctx)).toBeNull();
  });
});

describe("activationDueAt", () => {
  const ctx = { subjectCreatedAt: fri, appliedAt: fri, targetStartDate: null };
  it("counts PREDECESSOR from the activation moment and falls back for an unknown target start", () => {
    expect(activationDueAt({ anchor: "PREDECESSOR", dueOffsetBusinessDays: 2 }, fri, ctx).getDate()).toBe(6);
    expect(activationDueAt({ anchor: "TARGET_START", dueOffsetBusinessDays: -5 }, fri, ctx).getDate()).toBe(2);
  });
});

describe("recomputeAfterTargetStartChange", () => {
  it("moves only open, unlocked, TARGET_START tasks", () => {
    const base = { dueOffsetBusinessDays: 0, activatedAt: fri };
    const out = recomputeAfterTargetStartChange(
      [
        { id: "a", anchor: "TARGET_START", status: "PENDING", dueLocked: false, ...base },
        { id: "b", anchor: "TARGET_START", status: "PENDING", dueLocked: true, ...base },
        { id: "c", anchor: "TARGET_START", status: "COMPLETED", dueLocked: false, ...base },
        { id: "d", anchor: "PREDECESSOR", status: "PENDING", dueLocked: false, ...base },
      ],
      { subjectCreatedAt: fri, appliedAt: fri, targetStartDate: new Date(2026, 9, 7) },
    );
    expect(out.map((o) => o.id)).toEqual(["a"]);
    expect(out[0]!.dueAt!.getDate()).toBe(7);
  });
});

describe("violation-case anchors", () => {
  const ctx = { subjectCreatedAt: fri, appliedAt: fri, targetStartDate: null, complianceDeadline: new Date(2026, 9, 14), hearingDate: null };

  it("COMPLIANCE_DEADLINE counts back in business days from the current deadline and is null without one", () => {
    // Wed Oct 14 − 3 business days = Fri Oct 9.
    expect(initialDueAt({ anchor: "COMPLIANCE_DEADLINE", dueOffsetBusinessDays: -3 }, ctx)!.getDate()).toBe(9);
    expect(initialDueAt({ anchor: "COMPLIANCE_DEADLINE", dueOffsetBusinessDays: -3 }, { ...ctx, complianceDeadline: null })).toBeNull();
    expect(initialDueAt({ anchor: "HEARING_DATE", dueOffsetBusinessDays: -1 }, ctx)).toBeNull();
    expect(initialDueAt({ anchor: "HEARING_DATE", dueOffsetBusinessDays: -1 }, { ...ctx, hearingDate: new Date(2026, 9, 13) })!.getDate()).toBe(12);
  });

  it("a step activated before the date is known falls back to activation, like TARGET_START", () => {
    expect(activationDueAt({ anchor: "HEARING_DATE", dueOffsetBusinessDays: -5 }, fri, ctx).getDate()).toBe(2);
  });

  it("recomputeAfterAnchorChange moves only the open, unlocked steps on that anchor", () => {
    const base = { dueOffsetBusinessDays: -1, activatedAt: fri };
    const out = recomputeAfterAnchorChange(
      [
        { id: "a", anchor: "COMPLIANCE_DEADLINE", status: "PENDING", dueLocked: false, ...base },
        { id: "b", anchor: "COMPLIANCE_DEADLINE", status: "PENDING", dueLocked: true, ...base },
        { id: "c", anchor: "COMPLIANCE_DEADLINE", status: "COMPLETED", dueLocked: false, ...base },
        { id: "d", anchor: "HEARING_DATE", status: "PENDING", dueLocked: false, ...base },
        { id: "e", anchor: "TARGET_START", status: "PENDING", dueLocked: false, ...base },
      ],
      { ...ctx, complianceDeadline: new Date(2026, 9, 21) },
      "COMPLIANCE_DEADLINE",
    );
    expect(out.map((o) => o.id)).toEqual(["a"]);
    expect(out[0]!.dueAt!.getDate()).toBe(20);
  });
});

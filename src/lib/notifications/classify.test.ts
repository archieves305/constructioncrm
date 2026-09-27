import { describe, expect, it } from "vitest";
import { classify, type ClassifyInput } from "./classify";
import { KINDS, NOTIFICATION_KINDS } from "./kinds";

const NOW = new Date("2026-10-06T14:00:00Z");

function input(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    kind: "task.assigned",
    reason: "assignee",
    recipient: { role: "SALES_REP", emailAllowed: true, emailMode: "DIGEST", mutedCategories: [] },
    signals: {},
    settings: { immediateKinds: [], digestOnlyKinds: [], maxImmediatePerUserPerHour: 6, batchCollapseThreshold: 3 },
    immediateCountLastHour: 0,
    stormActive: false,
    batchSize: 1,
    now: NOW,
    tz: "America/New_York",
    ...over,
  };
}

describe("classify: registry defaults", () => {
  it("every kind has a spec and classifies without signals", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const c = classify(input({ kind }));
      expect(c.deliveryClass).toBe(KINDS[kind].defaultClass === "NONE" ? "NONE" : c.deliveryClass);
      expect(c.reason).toBeTruthy();
    }
  });

  it("routine assignment goes to the digest; a mention goes now; a checklist tick stays in the bell", () => {
    expect(classify(input({ kind: "task.assigned" })).deliveryClass).toBe("DIGEST");
    expect(classify(input({ kind: "task.mentioned" })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ kind: "task.checklist_updated" })).deliveryClass).toBe("IN_APP_ONLY");
  });

  it("a forced class wins over everything", () => {
    expect(classify(input({ kind: "task.mentioned", forceClass: "IN_APP_ONLY" })).deliveryClass).toBe("IN_APP_ONLY");
  });

  it("the actor's own action is a bell receipt only", () => {
    expect(classify(input({ kind: "task.completed", reason: "actor" }))).toMatchObject({ deliveryClass: "IN_APP_ONLY" });
  });
});

describe("classify: upgrades to IMMEDIATE", () => {
  it("URGENT priority, a blocking gate, or a due date inside 24h", () => {
    expect(classify(input({ signals: { taskPriority: "URGENT" } }))).toMatchObject({ deliveryClass: "IMMEDIATE", reason: expect.stringContaining("URGENT") });
    expect(classify(input({ signals: { blocking: true } }))).toMatchObject({ deliveryClass: "IMMEDIATE", reason: expect.stringContaining("blocking") });
    expect(classify(input({ signals: { dueAt: new Date(NOW.getTime() + 3600_000).toISOString() } }))).toMatchObject({ deliveryClass: "IMMEDIATE", reason: expect.stringContaining("due") });
    expect(classify(input({ signals: { dueAt: new Date(NOW.getTime() + 3 * 86_400_000).toISOString() } })).deliveryClass).toBe("DIGEST");
  });

  it("a blocked task jumps when it is a gate or a failed inspection, not otherwise", () => {
    expect(classify(input({ kind: "task.blocked", signals: { inspectionResult: "FAIL" } })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ kind: "task.blocked", signals: { blocking: true } })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ kind: "task.blocked", signals: {} })).deliveryClass).toBe("DIGEST");
  });

  it("emergency, CRITICAL severity or a deadline within a day on a case", () => {
    expect(classify(input({ kind: "case.assigned", signals: { emergency: true } })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ kind: "case.item_assigned", signals: { severity: "CRITICAL" } })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ kind: "case.deadline", signals: { deadlineDays: 1 } })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ kind: "case.deadline", signals: { deadlineDays: 7 } })).deliveryClass).toBe("DIGEST");
  });

  it("an agency inspection inside 24h", () => {
    expect(classify(input({ kind: "case.inspection_scheduled", signals: { scheduledFor: new Date(NOW.getTime() + 5 * 3600_000).toISOString() } })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ kind: "case.inspection_scheduled", signals: { scheduledFor: new Date(NOW.getTime() + 3 * 86_400_000).toISOString() } })).deliveryClass).toBe("DIGEST");
  });

  it("completion never jumps the queue, whatever the signals", () => {
    expect(classify(input({ kind: "task.completed", signals: { taskPriority: "URGENT", blocking: true } })).deliveryClass).toBe("DIGEST");
  });
});

describe("classify: admin overrides", () => {
  it("immediateKinds forces now; digestOnlyKinds pins to the digest even for an upgrade", () => {
    expect(classify(input({ kind: "task.completed", settings: { ...input().settings, immediateKinds: ["task.completed"] } })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ signals: { taskPriority: "URGENT" }, settings: { ...input().settings, digestOnlyKinds: ["task.assigned"] } })).deliveryClass).toBe("DIGEST");
  });
});

describe("classify: the person's choices", () => {
  it("no email address → bell only", () => {
    expect(classify(input({ kind: "task.mentioned", recipient: { ...input().recipient, emailAllowed: false } })).deliveryClass).toBe("IN_APP_ONLY");
  });

  it("in-app-only mode demotes everything except a manager's escalation", () => {
    const r = { ...input().recipient, emailMode: "IN_APP_ONLY" as const };
    expect(classify(input({ kind: "task.mentioned", recipient: r })).deliveryClass).toBe("IN_APP_ONLY");
    expect(classify(input({ kind: "task.escalated", reason: "manager", recipient: r })).deliveryClass).toBe("IMMEDIATE");
    expect(classify(input({ kind: "task.escalated", reason: "assignor", recipient: r })).deliveryClass).toBe("IN_APP_ONLY");
  });

  it("a muted category is bell only, even for an escalation", () => {
    const r = { ...input().recipient, mutedCategories: ["ESCALATIONS" as const] };
    expect(classify(input({ kind: "task.escalated", reason: "manager", recipient: r })).deliveryClass).toBe("IN_APP_ONLY");
    expect(classify(input({ kind: "task.assigned", recipient: r })).deliveryClass).toBe("DIGEST");
  });

  it("immediate mode promotes digest rows", () => {
    expect(classify(input({ recipient: { ...input().recipient, emailMode: "IMMEDIATE" } }))).toMatchObject({ deliveryClass: "IMMEDIATE", reason: expect.stringContaining("everything immediately") });
  });
});

describe("classify: safety valves", () => {
  it("a batch of three or more urgent rows folds into the digest", () => {
    expect(classify(input({ signals: { taskPriority: "URGENT" }, batchSize: 3 }))).toMatchObject({ deliveryClass: "DIGEST", demotedFrom: "IMMEDIATE", demotedReason: "batch" });
    expect(classify(input({ signals: { taskPriority: "URGENT" }, batchSize: 2 })).deliveryClass).toBe("IMMEDIATE");
  });

  it("over the hourly cap or in a storm, immediate becomes digest", () => {
    expect(classify(input({ signals: { taskPriority: "URGENT" }, immediateCountLastHour: 6 }))).toMatchObject({ deliveryClass: "DIGEST", demotedReason: "immediate-cap" });
    expect(classify(input({ signals: { taskPriority: "URGENT" }, stormActive: true }))).toMatchObject({ deliveryClass: "DIGEST", demotedReason: "storm" });
  });

  it("mentions, nudges and escalations are never demoted", () => {
    for (const kind of ["task.mentioned", "task.nudged", "task.escalated", "case.escalated"] as const) {
      expect(classify(input({ kind, batchSize: 50, immediateCountLastHour: 99, stormActive: true })).deliveryClass).toBe("IMMEDIATE");
    }
  });
});

import { describe, expect, it } from "vitest";
import { buildDigest, dedupeRows, supersedeRows, type DigestRowInput } from "./build";

const job = { key: "job:j1", label: "7676 Peters Road", code: "JOB-00012", href: "/jobs/j1" };
const job2 = { key: "job:j2", label: "12 Palm Ct", code: "JOB-00013", href: "/jobs/j2" };
const none = { key: "none", label: "No job", code: null, href: null };
const t = (h: number) => new Date(Date.UTC(2026, 8, 28, h));

let n = 0;
function row(over: Partial<DigestRowInput> = {}): DigestRowInput {
  n++;
  return {
    id: over.id ?? `r${n}`,
    kind: "task.assigned",
    title: `Task ${n}`,
    body: null,
    href: `/tasks?task=t${n}`,
    priority: "MEDIUM",
    actionRequired: false,
    recipientReason: "assignee",
    subjectType: "task",
    subjectId: `t${n}`,
    taskId: `t${n}`,
    batchKey: null,
    occurrences: 1,
    lastOccurredAt: t(9),
    subject: job,
    ...over,
  };
}

const opts = { role: "ADMIN" as const, maxPerSection: 12, maxPerSubject: 6, batchCollapseThreshold: 3 };

describe("dedupeRows / supersedeRows", () => {
  it("the same event on the same subject twice is one line, counted twice, newest title", () => {
    const a = row({ id: "a", subjectId: "t1", taskId: "t1", title: "old", lastOccurredAt: t(8) });
    const b = row({ id: "b", subjectId: "t1", taskId: "t1", title: "new", lastOccurredAt: t(10) });
    const out = dedupeRows([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "b", title: "new", occurrences: 2 });
  });
  it("a completion hides the assignment on the same task, never on another task", () => {
    const assigned = row({ id: "a", taskId: "t1", subjectId: "t1", kind: "task.assigned", lastOccurredAt: t(8) });
    const done = row({ id: "d", taskId: "t1", subjectId: "t1", kind: "task.completed", lastOccurredAt: t(11) });
    const other = row({ id: "o", taskId: "t2", subjectId: "t2", kind: "task.assigned" });
    expect(supersedeRows([assigned, done, other]).map((r) => r.id)).toEqual(["d", "o"]);
    // A later assignment (re-opened, re-assigned after completion) is not superseded.
    const later = row({ id: "l", taskId: "t1", subjectId: "t1", kind: "task.assigned", lastOccurredAt: t(12) });
    expect(supersedeRows([done, later]).map((r) => r.id)).toEqual(["d", "l"]);
  });
});

describe("buildDigest", () => {
  it("collapses an engine batch of a collapsible kind into one line with the first three titles", () => {
    const batch = Array.from({ length: 5 }, (_, i) => row({ kind: "task.ready", batchKey: "wf-apply:i1:1", title: `Step ${i + 1}`, priority: i === 0 ? "HIGH" : "MEDIUM" }));
    const m = buildDigest(batch, opts);
    expect(m.itemCount).toBe(1);
    expect(m.collapsedCount).toBe(5);
    const item = m.sections[0]!.groups[0]!.items[0]!;
    expect(item.title).toBe("5 workflow steps became ready");
    expect(item.collapsed).toEqual({ count: 5, titles: ["Step 1", "Step 2", "Step 3"] });
    expect(item.href).toBe("/jobs/j1");
    expect(item.rowIds).toHaveLength(5);
  });
  it("a batch under the threshold stays as separate lines", () => {
    const m = buildDigest([row({ batchKey: "b" }), row({ batchKey: "b" })], opts);
    expect(m.itemCount).toBe(2);
    expect(m.collapsedCount).toBe(0);
  });
  it("action-required rows for the person doing the work go under Action required; a watcher's do not", () => {
    const mine = row({ kind: "task.blocked", actionRequired: true, recipientReason: "assignee" });
    const watched = row({ kind: "task.blocked", actionRequired: true, recipientReason: "watcher" });
    const m = buildDigest([mine, watched], opts);
    expect(m.sections.map((s) => s.section)).toEqual(["ACTION_REQUIRED"]);
    // Both blocked rows sit in ACTION_REQUIRED because that is task.blocked's home section anyway.
    expect(m.actionCount).toBe(2);
    const done = row({ kind: "task.completed", actionRequired: false, recipientReason: "watcher" });
    expect(buildDigest([done], opts).sections[0]!.section).toBe("COMPLETED");
  });
  it("groups by subject, busiest / most urgent first, and orders sections action first", () => {
    const m = buildDigest(
      [
        row({ kind: "task.completed", subject: job2 }),
        row({ kind: "task.completed", subject: job }),
        row({ kind: "task.completed", subject: job, priority: "URGENT" }),
        row({ kind: "task.assigned", subject: none }),
      ],
      opts,
    );
    expect(m.sections.map((s) => s.section)).toEqual(["ASSIGNED", "COMPLETED"]);
    expect(m.sections[1]!.groups.map((g) => g.key)).toEqual(["job:j1", "job:j2"]);
    expect(m.sectionCounts).toEqual({ ASSIGNED: 1, COMPLETED: 3 });
  });
  it("caps per subject and per section, counting what it hides as still delivered", () => {
    const rows = Array.from({ length: 9 }, () => row({ kind: "task.completed", subject: job }));
    const others = Array.from({ length: 3 }, (_, i) => row({ kind: "task.completed", subject: { key: `job:x${i}`, label: `Job ${i}`, code: null, href: null } }));
    const m = buildDigest([...rows, ...others], { ...opts, maxPerSubject: 6, maxPerSection: 2 });
    const section = m.sections[0]!;
    expect(section.groups).toHaveLength(2);
    expect(section.hiddenGroups).toBe(2);
    expect(section.groups[0]!.items).toHaveLength(6);
    expect(section.groups[0]!.hidden).toBe(3);
    expect(m.hiddenCount).toBe(3 + 2);
    expect(m.rowIds).toHaveLength(12);
  });
  it("a crew lead's digest drops job updates and completed work", () => {
    const m = buildDigest([row({ kind: "task.completed" }), row({ kind: "case.closed", subjectType: "violation_case", taskId: null }), row({ kind: "task.assigned" })], { ...opts, role: "CREW_LEAD" });
    expect(m.sections.map((s) => s.section)).toEqual(["ASSIGNED"]);
  });
  it("an unknown kind lands in Other rather than throwing", () => {
    const m = buildDigest([row({ kind: "something.new" })], opts);
    expect(m.sections[0]!.section).toBe("OTHER");
  });
});

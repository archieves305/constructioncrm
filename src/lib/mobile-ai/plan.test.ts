import { describe, expect, it } from "vitest";
import { logDraftFrom, numbered, taskDraftFrom, voiceSubjectId } from "./plan";

const jobs = numbered([{ id: "j1", l: "2188 Wind Trace" }, { id: "j2", l: "3001 SW 23 Ter" }], (r) => r.id, (r) => r.l);
const people = numbered([{ id: "u1", l: "Lisette Ruiz" }], (r) => r.id, (r) => r.l);
const base = { title: " Order drywall ", description: null, jobNumber: 2, assigneeNumber: 1, dueDate: "2026-11-10", priority: "HIGH" as const, unclear: [] };

describe("task draft", () => {
  it("maps numbers to the records offered", () => {
    const d = taskDraftFrom(base, jobs, people, "2026-11-08");
    expect(d).toMatchObject({ title: "Order drywall", jobId: "j2", jobLabel: "3001 SW 23 Ter", assignedUserId: "u1", dueDate: "2026-11-10", priority: "HIGH", unclear: [] });
  });
  it("drops a number outside the lists and says so", () => {
    const d = taskDraftFrom({ ...base, jobNumber: 9, assigneeNumber: 4 }, jobs, people, "2026-11-08");
    expect(d.jobId).toBeNull();
    expect(d.assignedUserId).toBeNull();
    expect(d.unclear).toHaveLength(2);
  });
  it("refuses a malformed or past due date", () => {
    expect(taskDraftFrom({ ...base, dueDate: "Friday" }, jobs, people, "2026-11-08").dueDate).toBeNull();
    const past = taskDraftFrom({ ...base, dueDate: "2026-11-01" }, jobs, people, "2026-11-08");
    expect(past.dueDate).toBeNull();
    expect(past.unclear[0]).toMatch(/past/);
  });
  it("never leaves an empty title", () => {
    expect(taskDraftFrom({ ...base, title: "  " }, jobs, people, "2026-11-08").title).toBe("New task");
  });
});

describe("log draft", () => {
  it("keeps only what was said", () => {
    const d = logDraftFrom({ workPerformed: " Set trusses ", areasWorked: null, delays: "", safetyIssues: null, materialsDelivered: null, subcontractorsOnsite: null, tomorrowPlan: "Sheathing", notes: null, safetyToolboxTalk: true, safetyPpeVerified: null, safetyHousekeeping: false });
    expect(d).toEqual({ workPerformed: "Set trusses", tomorrowPlan: "Sheathing", safetyToolboxTalk: true, safetyHousekeeping: false });
  });
});

it("one allowance per person per month", () => {
  expect(voiceSubjectId("u1", "2026-11-08")).toBe("u1:2026-11");
});

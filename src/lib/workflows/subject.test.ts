import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const { allowedTemplateKinds, instanceCreateLink, instanceWhere, refOf, requiresCore, scheduleContextFor, taskLinkWhere, taskLinksFor } = await import("./subject");

/**
 * The pure half of the subject seam: what a job and a violation case each
 * offer the engine. A case's tasks carry the case (and its lead) and never
 * the linked corrective job.
 */

const fri = new Date(2026, 9, 2, 10);
const deadline = new Date(2026, 10, 15);
const hearing = new Date(2026, 10, 20);

const job = { kind: "job" as const, id: "j1", leadId: "l1", createdAt: fri, dates: { targetStartDate: new Date(2026, 9, 20), complianceDeadline: null, hearingDate: null } };
const violation = { kind: "violation" as const, id: "c1", leadId: "l1", createdAt: fri, dates: { targetStartDate: null, complianceDeadline: deadline, hearingDate: hearing } };

describe("workflow subject", () => {
  it("a job needs Core and composes CORE + TRADE; a case runs one VIOLATION template alone", () => {
    expect(requiresCore("job")).toBe(true);
    expect(requiresCore("violation")).toBe(false);
    expect(allowedTemplateKinds("job")).toEqual(["CORE", "TRADE"]);
    expect(allowedTemplateKinds("violation")).toEqual(["VIOLATION"]);
  });

  it("instance ownership is keyed by whichever id the subject has", () => {
    expect(instanceWhere({ kind: "job", jobId: "j1" })).toEqual({ jobId: "j1" });
    expect(instanceWhere({ kind: "violation", violationCaseId: "c1" })).toEqual({ violationCaseId: "c1" });
    expect(instanceCreateLink({ kind: "job", jobId: "j1" })).toEqual({ jobId: "j1" });
    expect(instanceCreateLink({ kind: "violation", violationCaseId: "c1" })).toEqual({ violationCaseId: "c1" });
    expect(refOf(job)).toEqual({ kind: "job", jobId: "j1" });
    expect(refOf(violation)).toEqual({ kind: "violation", violationCaseId: "c1" });
  });

  it("task links: a job step carries the job; a case step carries the case, never a jobId", () => {
    expect(taskLinksFor(job)).toEqual({ leadId: "l1", jobId: "j1" });
    expect(taskLinksFor(violation)).toEqual({ leadId: "l1", violationCaseId: "c1" });
    expect(taskLinkWhere(job)).toEqual({ jobId: "j1" });
    expect(taskLinkWhere(violation)).toEqual({ violationCaseId: "c1" });
  });

  it("schedule context maps each subject's dates onto the anchors", () => {
    expect(scheduleContextFor(job, fri)).toEqual({ subjectCreatedAt: fri, appliedAt: fri, targetStartDate: job.dates.targetStartDate, complianceDeadline: null, hearingDate: null });
    expect(scheduleContextFor(violation, fri)).toEqual({ subjectCreatedAt: fri, appliedAt: fri, targetStartDate: null, complianceDeadline: deadline, hearingDate: hearing });
    // The Apply dialog may override the target start (undefined = keep the subject's).
    expect(scheduleContextFor(job, fri, { targetStartDate: null }).targetStartDate).toBeNull();
    expect(scheduleContextFor(job, fri, {}).targetStartDate).toEqual(job.dates.targetStartDate);
  });
});

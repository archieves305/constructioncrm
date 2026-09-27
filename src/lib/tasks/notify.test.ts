import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The producer side: who is told about which task event, and that the
 * legacy mail still goes when notifications v2 says so.
 */

const db = vi.hoisted(() => ({
  task: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  taskEvent: { findMany: vi.fn() },
}));
const notify = vi.hoisted(() => vi.fn());
const sendEmail = vi.hoisted(() => vi.fn());
const resolveRecipients = vi.hoisted(() => vi.fn());
const taskAudience = vi.hoisted(() => vi.fn());
const envFlags = vi.hoisted(() => ({ WORKFLOW_READY_EMAILS_ENABLED: "0", APP_BASE_URL: "https://crm.test" }));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/env", () => ({ env: envFlags }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } }));
vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a), isEmailConfigured: () => true }));
vi.mock("@/lib/email/brand", () => ({
  formatBrandAddress: () => "",
  getEmailBrand: async () => ({
    id: "d",
    companyName: "KNU",
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zip: null,
    officePhone: null,
    mobilePhone: null,
    contactEmail: null,
    website: null,
    logoUrl: null,
    primaryColor: "#123456",
    signatureHtml: null,
    signatureText: null,
    updatedAt: new Date(),
  }),
}));
vi.mock("@/lib/email/delivery-report", () => ({ reportDelivery: vi.fn() }));
vi.mock("./events", () => ({ recordTaskEvent: vi.fn() }));
vi.mock("./recipients", () => ({
  resolveRecipients: (...a: unknown[]) => resolveRecipients(...a),
  taskAudience: (...a: unknown[]) => taskAudience(...a),
}));
vi.mock("@/lib/notifications/notify", () => ({ notify: (...a: unknown[]) => notify(...a) }));

const mod = await import("./notify");

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Frame conference room",
  description: null,
  status: "PENDING",
  priority: "MEDIUM",
  dueAt: null,
  blockedReason: null,
  assignedUserId: "u-a",
  createdByUserId: "u-creator",
  jobId: "j1",
  leadId: "l1",
  violationCaseId: null,
  blocking: false,
  workflowTaskKey: null,
  sourceKey: null,
  inspectionResult: null,
  job: { id: "j1", jobNumber: "JOB-00012", title: "Office", serviceType: "Remodel", projectManagerId: "u-pm", lead: { id: "l1", fullName: "Acme", companyName: "Acme", propertyAddress1: "7676 Peters Rd", propertyAddress2: null, city: "Plantation", state: "FL", zipCode: "33324" } },
  lead: { id: "l1", fullName: "Acme", companyName: "Acme", propertyAddress1: "7676 Peters Rd", propertyAddress2: null, city: "Plantation", state: "FL", zipCode: "33324" },
  violationCase: null,
  invoice: null,
  estimate: null,
  prospect: null,
  dailyLog: null,
  assignedTo: { firstName: "Al", lastName: "A" },
  createdBy: { firstName: "Cy", lastName: "C" },
  completedBy: null,
  ...over,
});

beforeEach(() => {
  db.task.findUnique.mockReset().mockResolvedValue(task());
  db.user.findUnique.mockReset().mockResolvedValue({ firstName: "Mike", lastName: "M" });
  db.taskEvent.findMany.mockReset().mockResolvedValue([]);
  notify.mockReset().mockResolvedValue({ legacy: false, takeover: true, rows: [], skipped: [], deduped: 0 });
  sendEmail.mockReset().mockResolvedValue({ id: "m1" });
  resolveRecipients.mockReset().mockResolvedValue({ recipients: [], skipped: [] });
  taskAudience.mockReset().mockResolvedValue([
    { userId: "u-a", reason: "assignee" },
    { userId: "u-creator", reason: "assignor" },
    { userId: "u-w", reason: "watcher" },
  ]);
  envFlags.WORKFLOW_READY_EMAILS_ENABLED = "0";
});

describe("notifyTaskAssigned", () => {
  it("records an assignment with the task's signals, subject and link", async () => {
    await mod.notifyTaskAssigned({ taskId: "t1", actorUserId: "u-actor", batch: { key: "b", size: 2 } });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "task.assigned",
      candidates: [{ userId: "u-a", reason: "assignee" }],
      actorUserId: "u-actor",
      subject: { type: "task", id: "t1", taskId: "t1", jobId: "j1", leadId: "l1", violationCaseId: null },
      title: "Frame conference room",
      body: expect.stringContaining("Assigned to you by Mike M"),
      href: "/tasks?task=t1",
      signals: expect.objectContaining({ taskPriority: "MEDIUM", blocking: false, engineTask: false }),
      batch: { key: "b", size: 2 },
    }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a Ready workflow step is its own kind and, on the legacy path, stays behind the env flag", async () => {
    notify.mockResolvedValue({ legacy: true, takeover: false, rows: [], skipped: [], deduped: 0 });
    resolveRecipients.mockResolvedValue({ recipients: [{ userId: "u-a", email: "a@k.com", firstName: "Al", lastName: "A", role: "SALES_REP", reason: "assignee" }], skipped: [] });
    await mod.notifyTaskAssigned({ taskId: "t1", actorUserId: "u-actor", readyStep: true });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "task.ready" }));
    expect(sendEmail).not.toHaveBeenCalled();

    envFlags.WORKFLOW_READY_EMAILS_ENABLED = "1";
    await mod.notifyTaskAssigned({ taskId: "t1", actorUserId: "u-actor", readyStep: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("the legacy mail goes when v2 is not delivering", async () => {
    notify.mockResolvedValue({ legacy: true, takeover: false, rows: [], skipped: [], deduped: 0 });
    resolveRecipients.mockResolvedValue({ recipients: [{ userId: "u-a", email: "a@k.com", firstName: "Al", lastName: "A", role: "CREW_LEAD", reason: "assignee" }], skipped: [] });
    await mod.notifyTaskAssigned({ taskId: "t1", actorUserId: "u-actor" });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "a@k.com", subject: expect.stringContaining("Frame conference room") }));
    expect(sendEmail.mock.calls[0][0].html).toContain("https://crm.test/field/tasks/t1");
  });
});

describe("notifyTaskCompleted", () => {
  it("on a manual task: assignee, raiser, watchers, the job's PM as owner, and the actor as a receipt", async () => {
    await mod.notifyTaskCompleted({ taskId: "t1", actorUserId: "u-a" });
    const call = notify.mock.calls[0][0];
    expect(call.kind).toBe("task.completed");
    expect(call.suppressActor).toBe(false);
    expect(call.candidates).toEqual([
      { userId: "u-a", reason: "assignee" },
      { userId: "u-creator", reason: "assignor" },
      { userId: "u-w", reason: "watcher" },
      { userId: "u-pm", reason: "owner" },
      { userId: "u-a", reason: "actor" },
    ]);
    expect(call.body).toContain("Completed by Mike M");
  });

  it("on a workflow step the applier (raiser) is dropped; the owner still hears", async () => {
    db.task.findUnique.mockResolvedValue(task({ workflowTaskKey: "core:frame", createdByUserId: "u-applier" }));
    taskAudience.mockResolvedValue([
      { userId: "u-a", reason: "assignee" },
      { userId: "u-applier", reason: "assignor" },
    ]);
    await mod.notifyTaskCompleted({ taskId: "t1", actorUserId: "u-a" });
    const call = notify.mock.calls[0][0];
    expect(call.candidates.map((c: { userId: string }) => c.userId)).not.toContain("u-applier");
    expect(call.candidates).toContainEqual({ userId: "u-pm", reason: "owner" });
    expect(call.signals.engineTask).toBe(true);
  });

  it("a violation case task tells the case manager as owner", async () => {
    db.task.findUnique.mockResolvedValue(task({ jobId: null, job: null, violationCaseId: "c1", violationCase: { id: "c1", caseNumber: "CV-00003", caseManagerId: "u-cm" }, sourceKey: "wf:i:step" }));
    await mod.notifyTaskCompleted({ taskId: "t1", actorUserId: "u-x" });
    expect(notify.mock.calls[0][0].candidates).toContainEqual({ userId: "u-cm", reason: "owner" });
  });

  it("legacy completion mail is unchanged: whole audience, actor included", async () => {
    notify.mockResolvedValue({ legacy: true, takeover: false, rows: [], skipped: [], deduped: 0 });
    resolveRecipients.mockResolvedValue({ recipients: [], skipped: [] });
    await mod.notifyTaskCompleted({ taskId: "t1", actorUserId: "u-a" });
    expect(resolveRecipients).toHaveBeenCalledWith({ candidates: await taskAudience() });
  });
});

describe("notifyTaskBlocked / mentions / nudge", () => {
  it("blocked carries the reason and the inspection signal", async () => {
    db.task.findUnique.mockResolvedValue(task({ status: "BLOCKED", blockedReason: "Waiting on permit", inspectionResult: "FAIL" }));
    await mod.notifyTaskBlocked({ taskId: "t1", actorUserId: "u-actor" });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "task.blocked",
      body: expect.stringContaining("Waiting on permit"),
      signals: expect.objectContaining({ inspectionResult: "FAIL" }),
    }));
  });

  it("a mention goes to the mentioned people with the note excerpt", async () => {
    await mod.notifyTaskMentions({ taskId: "t1", actorUserId: "u-actor", mentionedUserIds: ["u-m1", "u-m2"], note: { authorName: "Mike M", body: "Can you look?", createdAt: new Date() } });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "task.mentioned",
      candidates: [{ userId: "u-m1", reason: "mentioned" }, { userId: "u-m2", reason: "mentioned" }],
      body: "Mike M: Can you look?",
    }));
  });

  it("a nudge goes to the assignee", async () => {
    await mod.notifyTaskNudged({ taskId: "t1", actorUserId: "u-actor", message: "Any update?" });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "task.nudged", body: "Mike M is checking in: Any update?" }));
  });
});

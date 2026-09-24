import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    file: { count: vi.fn() },
    jobPermit: { count: vi.fn() },
    jobWorkflowInstance: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
    taskEvent: { count: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

const { checkEvidence, mergeChecklist, readChecklist } = await import("./evidence");

const base = { id: "t1", jobId: "j1", workflowInstanceId: "w1", requiredEvidence: null, requiredEvidenceParam: null, checklist: null, inspectionResult: null } as const;

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
});

describe("checklist helpers", () => {
  it("reads only well-formed items and merges ticks by key with attribution", () => {
    const items = readChecklist([{ key: "a", label: "A", done: false }, { bogus: true }, "x"]);
    expect(items).toEqual([{ key: "a", label: "A", done: false, doneAt: null, doneByUserId: null }]);
    const now = new Date("2026-10-01T12:00:00Z");
    const merged = mergeChecklist(items, [{ key: "a", done: true }, { key: "zzz", done: true }], { userId: "u1", now });
    expect(merged.changed).toBe(true);
    expect(merged.items[0]).toMatchObject({ done: true, doneAt: now.toISOString(), doneByUserId: "u1" });
    expect(mergeChecklist(merged.items, [{ key: "a", done: true }], { userId: "u2", now }).changed).toBe(false);
  });
});

describe("checkEvidence", () => {
  it("checks the checklist before anything else", async () => {
    const r = await checkEvidence({ ...base, requiredEvidence: "ATTACHMENT", checklist: [{ key: "a", label: "A", done: false }, { key: "b", label: "B", done: true }] });
    expect(r).toEqual({ ok: false, hint: "checklist", message: "Finish the checklist first — 1 of 2 items still open" });
    expect(db.file.count).not.toHaveBeenCalled();
  });

  it("ATTACHMENT / PHOTO need a file on the task; PHOTO must be an image", async () => {
    db.file.count.mockResolvedValueOnce(0);
    expect((await checkEvidence({ ...base, requiredEvidence: "ATTACHMENT" })).ok).toBe(false);
    db.file.count.mockResolvedValueOnce(1);
    expect((await checkEvidence({ ...base, requiredEvidence: "ATTACHMENT" })).ok).toBe(true);
    db.file.count.mockResolvedValueOnce(0);
    const photo = await checkEvidence({ ...base, requiredEvidence: "PHOTO" });
    expect(photo.ok).toBe(false);
    expect(db.file.count.mock.calls.at(-1)![0].where.fileType).toEqual({ startsWith: "image/" });
  });

  it("PERMIT_NUMBER looks at the job's permits; PERMIT_DETERMINATION at the instance", async () => {
    db.jobPermit.count.mockResolvedValueOnce(0);
    expect((await checkEvidence({ ...base, requiredEvidence: "PERMIT_NUMBER" })).ok).toBe(false);
    db.jobWorkflowInstance.findUnique.mockResolvedValueOnce({ permitStatus: "UNDETERMINED" });
    expect((await checkEvidence({ ...base, requiredEvidence: "PERMIT_DETERMINATION" })).ok).toBe(false);
    db.jobWorkflowInstance.findUnique.mockResolvedValueOnce({ permitStatus: "NOT_REQUIRED" });
    expect((await checkEvidence({ ...base, requiredEvidence: "PERMIT_DETERMINATION" })).ok).toBe(true);
  });

  it("INSPECTION_RESULT accepts PASS or CONDITIONAL only", async () => {
    expect((await checkEvidence({ ...base, requiredEvidence: "INSPECTION_RESULT", inspectionResult: "FAIL" })).ok).toBe(false);
    expect((await checkEvidence({ ...base, requiredEvidence: "INSPECTION_RESULT", inspectionResult: "CONDITIONAL" })).ok).toBe(true);
  });

  it("PAYMENT_STATUS reads deposit / final from the job", async () => {
    db.job.findUnique.mockResolvedValue({ depositReceived: 0, depositReceivedDate: null, finalPaymentReceived: false });
    expect((await checkEvidence({ ...base, requiredEvidence: "PAYMENT_STATUS", requiredEvidenceParam: "DEPOSIT" })).ok).toBe(false);
    db.job.findUnique.mockResolvedValue({ depositReceived: 500, depositReceivedDate: null, finalPaymentReceived: false });
    expect((await checkEvidence({ ...base, requiredEvidence: "PAYMENT_STATUS", requiredEvidenceParam: "DEPOSIT" })).ok).toBe(true);
    const fin = await checkEvidence({ ...base, requiredEvidence: "PAYMENT_STATUS", requiredEvidenceParam: "FINAL" });
    expect(fin).toMatchObject({ ok: false, hint: "payment" });
  });

  it("no requirement and an empty checklist is fine", async () => {
    expect(await checkEvidence(base)).toEqual({ ok: true });
  });
});

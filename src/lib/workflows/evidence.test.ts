import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    file: { count: vi.fn() },
    jobPermit: { count: vi.fn() },
    jobWorkflowInstance: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
    taskEvent: { count: vi.fn() },
    codeViolationCase: { findUnique: vi.fn() },
    codeViolationHearing: { findFirst: vi.fn() },
    codeViolationItem: { findMany: vi.fn() },
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

describe("checkEvidence — violation cases", () => {
  const step = { ...base, jobId: null, violationCaseId: "c1" };
  const caseRow = {
    id: "c1",
    jobId: null,
    agencyConfirmedAt: null,
    fineAccrualStoppedAt: null,
    officialBalanceAsOf: null,
    officialBalance: null,
    amountPaid: 0,
    fineResolvedAt: null,
    lienReleasedAt: null,
    correctiveWorkCompletedAt: null,
  };

  it("every case type needs a case, and says so", async () => {
    for (const ev of ["AGENCY_CONFIRMATION", "HEARING_RESULT", "FINE_STATUS", "VIOLATION_ITEMS", "LINKED_JOB", "LINKED_JOB_PERMIT"] as const) {
      expect(await checkEvidence({ ...base, requiredEvidence: ev }), ev).toMatchObject({ ok: false, message: "This step needs a code-violation case" });
    }
  });

  it("AGENCY_CONFIRMATION needs the agency's confirmation recorded on the case", async () => {
    db.codeViolationCase.findUnique.mockResolvedValue(caseRow);
    expect(await checkEvidence({ ...step, requiredEvidence: "AGENCY_CONFIRMATION" })).toMatchObject({ ok: false, hint: "agency" });
    db.codeViolationCase.findUnique.mockResolvedValue({ ...caseRow, agencyConfirmedAt: new Date() });
    expect(await checkEvidence({ ...step, requiredEvidence: "AGENCY_CONFIRMATION" })).toEqual({ ok: true });
  });

  it("HEARING_RESULT needs the latest non-cancelled hearing to have an outcome", async () => {
    db.codeViolationHearing.findFirst.mockResolvedValue({ outcome: null });
    expect(await checkEvidence({ ...step, requiredEvidence: "HEARING_RESULT" })).toMatchObject({ ok: false, hint: "hearing" });
    db.codeViolationHearing.findFirst.mockResolvedValue({ outcome: "COMPLIANCE_ORDERED" });
    expect(await checkEvidence({ ...step, requiredEvidence: "HEARING_RESULT" })).toEqual({ ok: true });
  });

  it("FINE_STATUS reads the official figures by param", async () => {
    const check = (param: string) => checkEvidence({ ...step, requiredEvidence: "FINE_STATUS", requiredEvidenceParam: param });
    db.codeViolationCase.findUnique.mockResolvedValue(caseRow);
    for (const p of ["STOPPED", "OFFICIAL_BALANCE", "PAID", "RESOLVED", "LIEN_RELEASED"]) expect(await check(p), p).toMatchObject({ ok: false, hint: "fine" });
    db.codeViolationCase.findUnique.mockResolvedValue({
      ...caseRow,
      fineAccrualStoppedAt: new Date(),
      officialBalanceAsOf: new Date(),
      officialBalance: 1200,
      amountPaid: 1200,
      fineResolvedAt: new Date(),
      lienReleasedAt: new Date(),
    });
    for (const p of ["STOPPED", "OFFICIAL_BALANCE", "PAID", "RESOLVED", "LIEN_RELEASED"]) expect(await check(p), p).toEqual({ ok: true });
    // Paid must cover the official balance.
    db.codeViolationCase.findUnique.mockResolvedValue({ ...caseRow, officialBalance: 1200, amountPaid: 800 });
    expect(await check("PAID")).toMatchObject({ ok: false });
  });

  it("VIOLATION_ITEMS: EXISTS needs one item; COMPLETE needs every item verified or withdrawn", async () => {
    db.codeViolationItem.findMany.mockResolvedValue([]);
    expect(await checkEvidence({ ...step, requiredEvidence: "VIOLATION_ITEMS", requiredEvidenceParam: "EXISTS" })).toMatchObject({ ok: false, hint: "items" });
    db.codeViolationItem.findMany.mockResolvedValue([{ status: "OPEN" }, { status: "VERIFIED" }]);
    expect(await checkEvidence({ ...step, requiredEvidence: "VIOLATION_ITEMS", requiredEvidenceParam: "EXISTS" })).toEqual({ ok: true });
    expect(await checkEvidence({ ...step, requiredEvidence: "VIOLATION_ITEMS", requiredEvidenceParam: "COMPLETE" })).toMatchObject({ ok: false, message: "1 violation item is not yet verified or withdrawn" });
    db.codeViolationItem.findMany.mockResolvedValue([{ status: "WITHDRAWN" }, { status: "VERIFIED" }]);
    expect(await checkEvidence({ ...step, requiredEvidence: "VIOLATION_ITEMS", requiredEvidenceParam: "COMPLETE" })).toEqual({ ok: true });
  });

  it("LINKED_JOB: EXISTS, WORKFLOW and COMPLETE read the case's corrective job", async () => {
    const lj = (param: string) => checkEvidence({ ...step, requiredEvidence: "LINKED_JOB", requiredEvidenceParam: param });
    db.codeViolationCase.findUnique.mockResolvedValue(caseRow);
    expect(await lj("EXISTS")).toMatchObject({ ok: false, hint: "job" });
    db.codeViolationCase.findUnique.mockResolvedValue({ ...caseRow, jobId: "j9" });
    expect(await lj("EXISTS")).toEqual({ ok: true });
    db.jobWorkflowInstance.findUnique.mockResolvedValueOnce(null);
    expect(await lj("WORKFLOW")).toMatchObject({ ok: false });
    db.jobWorkflowInstance.findUnique.mockResolvedValueOnce({ id: "w9" });
    expect(await lj("WORKFLOW")).toEqual({ ok: true });
    // Construction completion is the stamped fact, never inferred from the job's status.
    expect(await lj("COMPLETE")).toMatchObject({ ok: false, hint: "job" });
    db.codeViolationCase.findUnique.mockResolvedValue({ ...caseRow, jobId: "j9", correctiveWorkCompletedAt: new Date() });
    expect(await lj("COMPLETE")).toEqual({ ok: true });
  });

  it("LINKED_JOB_PERMIT and PERMIT_NUMBER both read the linked job's permits", async () => {
    db.codeViolationCase.findUnique.mockResolvedValue(caseRow);
    expect(await checkEvidence({ ...step, requiredEvidence: "LINKED_JOB_PERMIT", requiredEvidenceParam: "ISSUED" })).toMatchObject({ ok: false, hint: "permit" });
    expect(await checkEvidence({ ...step, requiredEvidence: "PERMIT_NUMBER" })).toMatchObject({ ok: false, message: expect.stringContaining("Link the corrective job") });
    db.codeViolationCase.findUnique.mockResolvedValue({ ...caseRow, jobId: "j9" });
    db.jobPermit.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(await checkEvidence({ ...step, requiredEvidence: "LINKED_JOB_PERMIT", requiredEvidenceParam: "ISSUED" })).toMatchObject({ ok: false, message: expect.stringContaining("issued") });
    expect(await checkEvidence({ ...step, requiredEvidence: "LINKED_JOB_PERMIT", requiredEvidenceParam: "FINAL" })).toEqual({ ok: true });
    expect(db.jobPermit.count.mock.calls[1][0].where).toEqual({ jobId: "j9", status: "FINAL" });
    db.jobPermit.count.mockResolvedValueOnce(1);
    expect(await checkEvidence({ ...step, requiredEvidence: "PERMIT_NUMBER" })).toEqual({ ok: true });
  });
});

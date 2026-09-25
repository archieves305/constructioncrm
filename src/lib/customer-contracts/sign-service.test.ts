import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, storage, render, pricing, autoTasks, tasks, email, audit, deferred } = vi.hoisted(() => ({
  deferred: [] as Promise<void>[],
  db: {
    customerContract: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    file: { create: vi.fn() },
    generatedDocument: { create: vi.fn() },
    job: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    changeOrder: { aggregate: vi.fn() },
    sovLine: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    invoice: { count: vi.fn() },
    estimate: { update: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  storage: { saveFile: vi.fn(), readFile: vi.fn() },
  render: { renderCustomerContractPdf: vi.fn() },
  pricing: { recomputeJobBalance: vi.fn() },
  autoTasks: { closeAutoTask: vi.fn(), ensureAutoTask: vi.fn(), onEstimateTransition: vi.fn(), sourceKeyFor: vi.fn((s: { contractId: string }) => `customer-contract:SENT:${s.contractId}`) },
  tasks: { createTask: vi.fn() },
  email: { sendContractEmail: vi.fn(), sendContractSignedCustomerEmail: vi.fn(), sendContractOutcomeInternalEmail: vi.fn(), signUrlFor: vi.fn((t: string) => `https://crm.test/sign/${t}`) },
  audit: { recordAudit: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/files/storage", () => storage);
vi.mock("@/lib/pdf/customer-contract", () => render);
vi.mock("@/lib/services/job-pricing", () => pricing);
vi.mock("@/lib/tasks/auto-tasks", () => autoTasks);
vi.mock("@/lib/tasks/create", () => tasks);
vi.mock("@/lib/tasks/defer", () => ({ runAfterResponse: (fn: () => Promise<void>) => { deferred.push(fn()); } }));
const settle = () => Promise.all(deferred.splice(0));
vi.mock("./email", () => email);
vi.mock("@/lib/audit/record", () => audit);
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } }));

const { declineContract, sendContract, signContract } = await import("./sign-service");

// A real 1×1 PNG padded past the "did you draw anything" floor.
const PNG_DATA_URI =
  "data:image/png;base64," +
  Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"), Buffer.alloc(300, 0)]).toString("base64");

const snapshot = {
  kind: "CUSTOMER_CONTRACT",
  template: { consentText: "I agree.", title: "Agreement" },
  price: { total: 25000 },
  depositAmount: 10000,
  paymentSchedule: [],
  owner: { name: "Jane" },
  jobSite: { line1: "1 Main", city: "FTL", state: "FL", zip: "33301" },
  job: { jobNumber: "JOB-1", title: "Roof" },
  scope: { sections: [] },
  validity: { offerExpiresAt: "2026-10-01T00:00:00Z" },
  company: { name: "Knu", licenses: [] },
  source: { estimateNumber: "EST-1" },
};

function contract(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    jobId: "j1",
    leadId: "l1",
    contractNumber: "JOB-1-C1",
    status: "SENT",
    token: "t".repeat(64),
    tokenExpiresAt: new Date("2026-12-01"),
    sentAt: new Date("2026-09-20"),
    sentToEmail: "jane@example.com",
    unsignedPdfSha256: "u".repeat(64),
    snapshotVersion: 1,
    contractAmount: "25000",
    depositAmount: "10000",
    snapshot,
    createdByUserId: "u1",
    estimate: { id: "e1", status: "SENT" },
    job: { jobType: "FIXED_PRICE", billingMethod: "LUMP_SUM", lead: { email: "jane@example.com", fullName: "Jane" } },
    createdBy: { id: "u1", email: "rep@knu.test" },
    sentBy: { id: "u1", email: "rep@knu.test" },
    documents: [{ documentType: "CUSTOMER_CONTRACT", versionNumber: 1, storageKey: "k", fileName: "JOB-1-C1-v1.pdf" }],
    ...over,
  };
}

beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group as Record<string, unknown>)) if (typeof fn === "function" && "mockReset" in (fn as object)) (fn as ReturnType<typeof vi.fn>).mockReset();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  storage.saveFile.mockResolvedValue({ storageKey: "stored", bytes: 10 });
  storage.readFile.mockResolvedValue(Buffer.from("%PDF-unsigned"));
  render.renderCustomerContractPdf.mockResolvedValue(Buffer.from("%PDF-signed"));
  db.file.create.mockResolvedValue({ id: "f1" });
  db.job.findUniqueOrThrow.mockResolvedValue({ jobType: "FIXED_PRICE", billingMethod: "LUMP_SUM", title: "Roof", projectManagerId: null, salesRepId: "u1" });
  db.changeOrder.aggregate.mockResolvedValue({ _sum: { customerPrice: 500 } });
  db.sovLine.findMany.mockResolvedValue([]);
  db.invoice.count.mockResolvedValue(0);
  db.customerContract.updateMany.mockResolvedValue({ count: 1 });
  email.sendContractEmail.mockResolvedValue(true);
});

describe("signContract", () => {
  it("signs once: writes the signed row, files, money, closes the follow-up and mails both sides", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract());
    const r = await signContract("t".repeat(64), { name: " Jane Owner ", email: "jane@example.com", signaturePngDataUri: PNG_DATA_URI }, { ip: "203.0.113.5", userAgent: "UA", now: new Date("2026-09-26T14:00:00Z") });
    await settle();
    expect(r.ok).toBe(true);

    const flip = db.customerContract.updateMany.mock.calls[0][0];
    expect(flip.where).toEqual({ id: "c1", status: "SENT" });
    expect(flip.data).toMatchObject({ status: "SIGNED", signerName: "Jane Owner", signerIp: "203.0.113.5", consentText: "I agree.", signatureStorageKey: "stored" });
    expect(flip.data.signedPdfSha256).toMatch(/^[0-9a-f]{64}$/);

    // The signed render carries the certificate inputs, from the stored snapshot.
    const rendered = render.renderCustomerContractPdf.mock.calls[0][0];
    expect(rendered.signature).toMatchObject({ signerName: "Jane Owner", unsignedPdfSha256: "u".repeat(64), contractId: "c1", ip: "203.0.113.5" });
    expect(rendered.signature.tokenSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rendered.signature.tokenSha256).not.toContain("tttt");

    expect(db.file.create.mock.calls[0][0].data).toMatchObject({ category: "SIGNED_DOC", uploadedByUserId: "u1" });
    expect(db.generatedDocument.create.mock.calls[0][0].data).toMatchObject({ documentType: "CUSTOMER_CONTRACT_SIGNED", customerContractId: "c1" });
    // Fixed price: signed base + approved change orders; deposit from the schedule.
    expect(db.job.update.mock.calls[0][0]).toEqual({ where: { id: "j1" }, data: { depositRequired: 10000, contractAmount: 25500 } });
    expect(db.customerContract.update.mock.calls[0][0].data.moneyAppliedAt).toBeInstanceOf(Date);
    expect(db.estimate.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { status: "ACCEPTED" } });
    expect(pricing.recomputeJobBalance).toHaveBeenCalledWith("j1");
    expect(audit.recordAudit.mock.calls[0][0]).toMatchObject({ action: "sign", actorUserId: null, ipAddress: "203.0.113.5", userAgent: "UA" });

    expect(autoTasks.closeAutoTask).toHaveBeenCalledWith("customer-contract:SENT:c1", expect.objectContaining({ outcome: "COMPLETED" }));
    expect(autoTasks.onEstimateTransition).toHaveBeenCalledWith("e1", "SENT", "ACCEPTED", "u1");
    expect(email.sendContractSignedCustomerEmail).toHaveBeenCalled();
    expect(email.sendContractOutcomeInternalEmail).toHaveBeenCalledWith(expect.anything(), "signed", ["rep@knu.test"], expect.anything());
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it("is single-use: a concurrent second submit sees count 0 and gets already_signed", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract());
    db.customerContract.updateMany.mockResolvedValue({ count: 0 });
    const r = await signContract("t".repeat(64), { name: "Jane", signaturePngDataUri: PNG_DATA_URI }, { ip: null, userAgent: null });
    expect(r).toEqual({ ok: false, reason: "already_signed" });
    expect(db.job.update).not.toHaveBeenCalled();
    expect(autoTasks.closeAutoTask).not.toHaveBeenCalled();
  });

  it("refuses an expired link before anything is written", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract({ tokenExpiresAt: new Date("2026-01-01") }));
    const r = await signContract("t".repeat(64), { name: "Jane", signaturePngDataUri: PNG_DATA_URI }, { ip: null, userAgent: null, now: new Date("2026-09-26") });
    expect(r).toEqual({ ok: false, reason: "expired" });
    expect(storage.saveFile).not.toHaveBeenCalled();
  });

  it("rejects a non-PNG or empty signature", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract());
    const r = await signContract("t".repeat(64), { name: "Jane", signaturePngDataUri: "data:image/png;base64,AAAA" }, { ip: null, userAgent: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("validation");
  });

  it("leaves the SOV alone and raises an office task when applications were issued", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract({ job: { jobType: "FIXED_PRICE", billingMethod: "PROGRESS", lead: { email: "j@x.test", fullName: "Jane" } } }));
    db.job.findUniqueOrThrow.mockResolvedValue({ jobType: "FIXED_PRICE", billingMethod: "PROGRESS", title: "Roof", projectManagerId: "pm1", salesRepId: "u1" });
    db.invoice.count.mockResolvedValue(2);
    const r = await signContract("t".repeat(64), { name: "Jane", signaturePngDataUri: PNG_DATA_URI }, { ip: null, userAgent: null });
    await settle();
    expect(r.ok).toBe(true);
    expect(db.sovLine.create).not.toHaveBeenCalled();
    expect(db.customerContract.update.mock.calls[0][0].data.moneyApplyNote).toMatch(/already been issued/);
    expect(tasks.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/Reconcile schedule of values/), assignedUserId: "pm1" }), expect.anything());
  });

  it("creates the base SOV line on a progress job with no schedule yet", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract());
    db.job.findUniqueOrThrow.mockResolvedValue({ jobType: "FIXED_PRICE", billingMethod: "PROGRESS", title: "Roof", projectManagerId: null, salesRepId: null });
    await signContract("t".repeat(64), { name: "Jane", signaturePngDataUri: PNG_DATA_URI }, { ip: null, userAgent: null });
    expect(db.sovLine.create.mock.calls[0][0].data).toMatchObject({ jobId: "j1", itemNo: 1, description: "Roof", scheduledValue: 25000 });
  });
});

describe("declineContract", () => {
  it("flips SENT → DECLINED, kills the token, cancels the follow-up and tells the office", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract());
    const r = await declineContract("t".repeat(64), { name: "Jane", reason: "Too expensive" }, { ip: "1.2.3.4", userAgent: "UA" });
    await settle();
    expect(r).toEqual({ ok: true });
    expect(db.customerContract.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "c1", status: "SENT" }, data: { status: "DECLINED", declineReason: "Too expensive", token: null } });
    expect(autoTasks.closeAutoTask).toHaveBeenCalledWith("customer-contract:SENT:c1", expect.objectContaining({ outcome: "CANCELLED" }));
    expect(email.sendContractOutcomeInternalEmail).toHaveBeenCalledWith(expect.anything(), "declined", ["rep@knu.test"]);
  });

  it("reports a decided contract", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract({ status: "DECLINED" }));
    expect(await declineContract("t".repeat(64), { name: "Jane" }, { ip: null, userAgent: null })).toEqual({ ok: false, reason: "already_decided" });
  });
});

describe("sendContract", () => {
  it("issues a token, hashes the stored PDF, emails and raises the follow-up", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract({ status: "DRAFT", token: null }));
    db.customerContract.findMany.mockResolvedValue([{ id: "c1", status: "DRAFT" }]);
    const r = await sendContract("c1", "u1", { message: "Thanks!" });
    await settle();
    expect(r.ok).toBe(true);
    expect(r.emailed).toBe(true);
    expect(r.sentTo).toBe("jane@example.com");
    const upd = db.customerContract.update.mock.calls[0][0].data;
    expect(upd.status).toBe("SENT");
    expect(upd.token).toMatch(/^[0-9a-f]{64}$/);
    expect(upd.unsignedPdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(email.sendContractEmail.mock.calls[0][2]).toMatchObject({ to: "jane@example.com", token: upd.token, message: "Thanks!" });
    expect(autoTasks.ensureAutoTask).toHaveBeenCalledWith({ kind: "contract.sent", contractId: "c1" }, "u1");
  });

  it("refuses when another contract on the job is out or signed", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract({ status: "DRAFT" }));
    db.customerContract.findMany.mockResolvedValue([{ id: "c1", status: "DRAFT" }, { id: "c0", status: "SENT" }]);
    await expect(sendContract("c1", "u1", {})).rejects.toMatchObject({ reason: "sent_exists" });
  });

  it("refuses without an email address", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract({ status: "DRAFT", job: { jobType: "FIXED_PRICE", billingMethod: "LUMP_SUM", lead: { email: null, fullName: "Jane" } } }));
    db.customerContract.findMany.mockResolvedValue([{ id: "c1", status: "DRAFT" }]);
    await expect(sendContract("c1", "u1", {})).rejects.toMatchObject({ reason: "no_email" });
  });

  it("refuses on a progress job that has issued applications", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract({ status: "DRAFT", job: { jobType: "FIXED_PRICE", billingMethod: "PROGRESS", lead: { email: "j@x.test", fullName: "Jane" } } }));
    db.customerContract.findMany.mockResolvedValue([{ id: "c1", status: "DRAFT" }]);
    db.invoice.count.mockResolvedValue(1);
    await expect(sendContract("c1", "u1", {})).rejects.toMatchObject({ reason: "applications_issued" });
  });

  it("stays SENT when the email fails, so the link can be shared by hand", async () => {
    db.customerContract.findUnique.mockResolvedValue(contract({ status: "DRAFT" }));
    db.customerContract.findMany.mockResolvedValue([{ id: "c1", status: "DRAFT" }]);
    email.sendContractEmail.mockRejectedValue(new Error("mailer down"));
    const r = await sendContract("c1", "u1", {});
    expect(r.ok).toBe(true);
    expect(r.emailed).toBe(false);
    expect(r.signUrl).toMatch(/^https:\/\/crm\.test\/sign\/[0-9a-f]{64}$/);
  });
});

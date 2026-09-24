import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Approval billing on the two billing methods, and the unwind on delete.
 * A PROGRESS job never gets a change-order invoice: the change order becomes
 * an SOV line and is billed through payment applications. LUMP_SUM keeps
 * issuing the invoice it always did.
 */

const co = {
  findUnique: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const invoice = { create: vi.fn(), delete: vi.fn() };
const invoiceLine = { deleteMany: vi.fn() };
const sovLine = { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() };
const job = { update: vi.fn() };
const activityLog = { create: vi.fn() };
const laborChangeOrder = { create: vi.fn(), delete: vi.fn() };
const client = {
  changeOrder: co,
  invoice,
  invoiceLine,
  sovLine,
  job,
  activityLog,
  laborChangeOrder,
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
};

vi.mock("@/lib/db/prisma", () => ({ prisma: client }));
vi.mock("@/lib/env", () => ({ env: { APP_BASE_URL: "http://localhost:4000" } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), exception: vi.fn() } }));
vi.mock("@/lib/email/brand", () => ({ getEmailBrand: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/pdf/change-order-bill", () => ({ renderChangeOrderBillPdf: vi.fn() }));
const { recomputeJobLabor, recomputeJobBalance } = vi.hoisted(() => ({ recomputeJobLabor: vi.fn(), recomputeJobBalance: vi.fn() }));
vi.mock("@/lib/services/job-pricing", () => ({ recomputeJobLabor, recomputeJobBalance }));
vi.mock("@/lib/services/invoices", () => ({ nextInvoiceNumber: vi.fn(async () => "INV-00001-3") }));
const { ensureAutoTask, closeAutoTask } = vi.hoisted(() => ({ ensureAutoTask: vi.fn(), closeAutoTask: vi.fn() }));
vi.mock("@/lib/tasks/auto-tasks", () => ({
  ensureAutoTask,
  closeAutoTask,
  sourceKeyFor: (k: { kind: string }) => `key:${k.kind}`,
}));
vi.mock("@/lib/tasks/defer", () => ({ runAfterResponse: (fn: () => Promise<unknown>) => void fn() }));

const { decideChangeOrderById, deleteChangeOrder } = await import("./change-orders");

function changeOrder(billingMethod: "LUMP_SUM" | "PROGRESS", over: Record<string, unknown> = {}) {
  return {
    id: "co1",
    jobId: "j1",
    number: 2,
    title: "Add corridor ceiling",
    description: null,
    customerPrice: "12500.00",
    crewCost: null,
    status: "SENT",
    token: "t",
    tokenExpiresAt: null,
    laborContractId: null,
    createdByUserId: "u1",
    job: {
      id: "j1",
      jobNumber: "JOB-00001",
      title: "Job",
      serviceType: "Drywall",
      jobType: "FIXED_PRICE",
      billingMethod,
      leadId: "l1",
      lead: { fullName: "Ann Owner", email: null, propertyAddress1: null, propertyAddress2: null, city: null, state: null, zipCode: null },
    },
    laborContract: null,
    ...over,
  };
}

beforeEach(() => {
  sovLine.create.mockImplementation(async ({ data }: { data: { itemNo: number } }) => ({ itemNo: data.itemNo }));
  invoice.create.mockResolvedValue({ id: "inv1" });
});

describe("approve on a PROGRESS job", () => {
  it("adds an SOV line for the change order and issues no invoice", async () => {
    co.findUnique.mockResolvedValue(changeOrder("PROGRESS"));
    sovLine.findMany.mockResolvedValue([{ itemNo: 1, sortOrder: 0 }]);

    const result = await decideChangeOrderById("co1", "APPROVE", "Ann Owner");

    expect(result).toEqual({ ok: true, status: "APPROVED", billing: "SOV", invoiceNumber: undefined, sovItemNo: 2 });
    expect(sovLine.create).toHaveBeenCalledWith({
      data: { jobId: "j1", itemNo: 2, sortOrder: 1, description: "CO-2: Add corridor ceiling", scheduledValue: 12500, changeOrderId: "co1" },
      select: { itemNo: true },
    });
    expect(invoice.create).not.toHaveBeenCalled();
    // Fixed-price contract still grows, so Σ SOV keeps matching the contract.
    expect(job.update).toHaveBeenCalledWith({ where: { id: "j1" }, data: { contractAmount: { increment: 12500 } } });
    expect(co.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", invoiceId: null }) }));
    expect(activityLog.create.mock.calls[0]![0].data.description).toMatch(/schedule of values as item #2/);
    expect(recomputeJobBalance).toHaveBeenCalledWith("j1");
    // No invoice → no invoice follow-up task; the CO follow-up still closes.
    expect(ensureAutoTask).not.toHaveBeenCalled();
    expect(closeAutoTask).toHaveBeenCalledWith("key:change-order.sent", expect.objectContaining({ outcome: "COMPLETED" }));
  });
});

describe("approve on a LUMP_SUM job", () => {
  it("still issues the change-order invoice", async () => {
    co.findUnique.mockResolvedValue(changeOrder("LUMP_SUM"));

    const result = await decideChangeOrderById("co1", "APPROVE", "Ann Owner");

    expect(result).toEqual({ ok: true, status: "APPROVED", billing: "INVOICE", invoiceNumber: "INV-00001-3", sovItemNo: undefined });
    expect(invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: 12500, status: "SENT" }) }));
    expect(sovLine.create).not.toHaveBeenCalled();
    expect(co.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ invoiceId: "inv1" }) }));
    expect(ensureAutoTask).toHaveBeenCalledWith({ kind: "invoice.sent", invoiceId: "inv1" }, "u1");
  });
});

describe("delete an approved change order", () => {
  const approved = (sov: { itemNo: number; invoiceLines: { workCompleted: string }[] } | null) => ({
    id: "co1",
    number: 2,
    status: "APPROVED",
    jobId: "j1",
    customerPrice: "12500.00",
    invoiceId: null,
    laborChangeOrderId: null,
    createdByUserId: "u1",
    job: { id: "j1", jobType: "FIXED_PRICE", leadId: "l1" },
    invoice: null,
    sovLine: sov ? { id: "sov2", ...sov } : null,
  });

  it("removes an unbilled SOV line and backs the contract out", async () => {
    co.findUnique.mockResolvedValue(approved({ itemNo: 2, invoiceLines: [] }));
    const result = await deleteChangeOrder("co1");
    expect(result).toEqual({ ok: true });
    expect(invoiceLine.deleteMany).toHaveBeenCalledWith({ where: { sovLineId: "sov2", invoice: { status: "VOID" } } });
    expect(sovLine.delete).toHaveBeenCalledWith({ where: { id: "sov2" } });
    expect(job.update).toHaveBeenCalledWith({ where: { id: "j1" }, data: { contractAmount: { decrement: 12500 } } });
    expect(activityLog.create.mock.calls[0]![0].data.description).toMatch(/SOV item #2 removed/);
  });

  it("refuses once an application has billed work on the line", async () => {
    co.findUnique.mockResolvedValue(approved({ itemNo: 2, invoiceLines: [{ workCompleted: "4000.00" }, { workCompleted: "1500.00" }] }));
    const result = await deleteChangeOrder("co1");
    expect(result).toEqual({ ok: false, reason: "has_billing", sovItemNo: 2, billed: 5500 });
    expect(co.delete).not.toHaveBeenCalled();
    expect(sovLine.delete).not.toHaveBeenCalled();
  });
});

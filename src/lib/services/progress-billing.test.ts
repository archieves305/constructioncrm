import { beforeEach, describe, expect, it, vi } from "vitest";

const jobFindUnique = vi.fn();
const sovFindMany = vi.fn();
const sovCount = vi.fn();
const sovCreate = vi.fn();
const invoiceFindMany = vi.fn();
const invoiceFindUnique = vi.fn();
const invoiceCount = vi.fn();
const invoiceCreate = vi.fn();
const invoiceUpdate = vi.fn();
const lineDeleteMany = vi.fn();
const lineCreateMany = vi.fn();
const activityCreate = vi.fn();

vi.mock("@/lib/db/prisma", () => {
  const client = {
    job: { findUnique: (...a: unknown[]) => jobFindUnique(...a) },
    sovLine: {
      findMany: (...a: unknown[]) => sovFindMany(...a),
      count: (...a: unknown[]) => sovCount(...a),
      create: (...a: unknown[]) => sovCreate(...a),
    },
    invoice: {
      findMany: (...a: unknown[]) => invoiceFindMany(...a),
      findUnique: (...a: unknown[]) => invoiceFindUnique(...a),
      count: (...a: unknown[]) => invoiceCount(...a),
      create: (...a: unknown[]) => invoiceCreate(...a),
      update: (...a: unknown[]) => invoiceUpdate(...a),
    },
    invoiceLine: {
      deleteMany: (...a: unknown[]) => lineDeleteMany(...a),
      createMany: (...a: unknown[]) => lineCreateMany(...a),
    },
    activityLog: { create: (...a: unknown[]) => activityCreate(...a) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  return { prisma: client };
});

const {
  computeApplication,
  createApplication,
  updateApplication,
  canVoidApplication,
  getBillingSummary,
  defaultRetainagePercent,
  seedSovIfEmpty,
} = await import("./progress-billing");

// JOB-00009 (Towne Place Suites Clewiston): the twelve AIA applications as
// imported, net of 10% retainage. The service must reproduce every one of
// these amounts from the gross work figures, to the cent.
const CONTRACT = 832_500;
const SOV = [{ id: "sov1", itemNo: 1, description: "Drywall, framing & ceilings", scheduledValue: CONTRACT }];
const APPS: [number, number, number][] = [
  // [app, gross work this period, net amount billed]
  [1, 35_000, 31_500],
  [2, 42_800, 38_520],
  [3, 81_448, 73_303.2],
  [4, 97_166, 87_449.4],
  [5, 70_184, 63_165.6],
  [6, 57_754, 51_978.6],
  [7, 21_172, 19_054.8],
  [8, 33_288, 29_959.2],
  [9, 71_354, 64_218.6],
  [10, 28_443, 25_598.7],
  [11, 32_500, 29_250],
  [12, 36_320, 32_688],
];

describe("computeApplication", () => {
  it("reproduces every JOB-00009 application amount from gross work", () => {
    let previous = 0;
    let certified = 0;
    for (const [n, gross, net] of APPS) {
      const app = computeApplication({
        contractSum: CONTRACT,
        retainagePercent: 10,
        sovLines: SOV,
        previousByLine: { sov1: previous },
        previousCertificates: certified,
        thisPeriod: [{ sovLineId: "sov1", workCompleted: gross }],
      });
      expect(app.currentDue, `app ${n}`).toBe(net);
      previous += gross;
      certified += net;
    }
    // After app 12 the form's bottom line is what the pressure test found.
    const last = computeApplication({
      contractSum: CONTRACT,
      retainagePercent: 10,
      sovLines: SOV,
      previousByLine: { sov1: previous },
      previousCertificates: certified,
      thisPeriod: [],
    });
    expect(last.completedToDate).toBe(607_429);
    expect(last.retainage).toBe(60_742.9);
    expect(last.earnedLessRetainage).toBe(546_686.1);
    expect(last.balanceToFinish).toBe(225_071);
  });

  it("bills the full period with no retainage on a residential job", () => {
    const app = computeApplication({
      contractSum: 20_000,
      retainagePercent: 0,
      sovLines: [
        { id: "a", itemNo: 1, description: "Demo", scheduledValue: 5_000 },
        { id: "b", itemNo: 2, description: "Tile", scheduledValue: 15_000 },
      ],
      previousByLine: { a: 5_000 },
      previousCertificates: 5_000,
      thisPeriod: [{ sovLineId: "b", workCompleted: 7_500 }],
    });
    expect(app.currentDue).toBe(7_500);
    expect(app.lines[0].percent).toBe(1);
    expect(app.lines[1].percent).toBe(0.5);
    expect(app.lines[1].balanceToFinish).toBe(7_500);
    expect(app.balanceToFinish).toBe(7_500);
  });

  it("rounds to cents rather than accumulating float noise", () => {
    const app = computeApplication({
      contractSum: 1_000,
      retainagePercent: 10,
      sovLines: [{ id: "a", itemNo: 1, description: "x", scheduledValue: 1_000 }],
      previousByLine: { a: 0.1 },
      previousCertificates: 0.09,
      thisPeriod: [{ sovLineId: "a", workCompleted: 0.2 }],
    });
    expect(app.completedToDate).toBe(0.3);
    expect(app.retainage).toBe(0.03);
    expect(app.currentDue).toBe(0.18);
  });
});

describe("defaultRetainagePercent", () => {
  it("is 10% commercial, 0% residential", () => {
    expect(defaultRetainagePercent("COMMERCIAL")).toBe(10);
    expect(defaultRetainagePercent("RESIDENTIAL")).toBe(0);
    expect(defaultRetainagePercent(null)).toBe(0);
  });
});

// ─── Service guards (mocked prisma) ─────────────────────────────────────────

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  applicationNumber: number;
  status: "DRAFT" | "SENT" | "PAID" | "VOID";
  amount: number;
  retainagePercent: number | null;
  issueDate: Date;
  dueDate: Date | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  paidAt: Date | null;
  notes: string | null;
  lines: { sovLineId: string; workCompleted: number }[];
  payments: { amount: number }[];
};

const app = (over: Partial<InvoiceRow> & { applicationNumber: number }): InvoiceRow => ({
  id: `inv${over.applicationNumber}`,
  invoiceNumber: `INV-00009-${over.applicationNumber}`,
  status: "SENT",
  amount: 0,
  retainagePercent: 10,
  issueDate: new Date("2026-01-31T00:00:00Z"),
  dueDate: null,
  periodFrom: null,
  periodTo: new Date("2026-01-31T00:00:00Z"),
  paidAt: null,
  notes: null,
  lines: [],
  payments: [],
  ...over,
});

const progressJob = {
  id: "job1",
  jobNumber: "JOB-00009",
  leadId: "lead1",
  billingMethod: "PROGRESS",
  contractAmount: CONTRACT,
  retainagePercent: 10,
  targetStartDate: new Date("2025-03-07T00:00:00Z"),
  createdAt: new Date("2025-03-07T00:00:00Z"),
  title: "Towne Place Suites",
  serviceType: "Drywall",
};

beforeEach(() => {
  for (const m of [
    jobFindUnique, sovFindMany, sovCount, sovCreate, invoiceFindMany, invoiceFindUnique,
    invoiceCount, invoiceCreate, invoiceUpdate, lineDeleteMany, lineCreateMany, activityCreate,
  ]) m.mockReset();
  jobFindUnique.mockResolvedValue(progressJob);
  sovFindMany.mockResolvedValue([
    { id: "sov1", itemNo: 1, description: "Drywall", scheduledValue: CONTRACT, sortOrder: 0 },
  ]);
  invoiceFindMany.mockResolvedValue([]);
  invoiceCreate.mockImplementation(async ({ data }) => ({ id: "new", invoiceNumber: data.invoiceNumber }));
});

describe("getBillingSummary", () => {
  it("rolls issued applications forward and leaves a draft out of the totals", async () => {
    invoiceFindMany.mockResolvedValue([
      app({ applicationNumber: 1, status: "PAID", amount: 31_500, lines: [{ sovLineId: "sov1", workCompleted: 35_000 }], payments: [{ amount: 31_500 }] }),
      app({ applicationNumber: 2, status: "SENT", amount: 38_520, lines: [{ sovLineId: "sov1", workCompleted: 42_800 }] }),
      app({ applicationNumber: 3, status: "DRAFT", amount: 900, lines: [{ sovLineId: "sov1", workCompleted: 1_000 }] }),
    ]);
    const s = await getBillingSummary("job1");
    expect(s?.totals).toEqual({
      completedToDate: 77_800,
      retainageHeld: 7_780,
      billedToDate: 70_020,
      collected: 31_500,
      openReceivable: 38_520,
      balanceToFinish: 754_700,
    });
    expect(s?.hasDraft).toBe(true);
    expect(s?.nextApplicationNumber).toBe(4);
    expect(s?.nextPeriodFrom).toBe("2026-02-01");
    // The draft's own numbers still read correctly against the issued ones.
    expect(s?.applications[2].computed.previousCertificates).toBe(70_020);
    expect(s?.applications[2].computed.currentDue).toBe(900);
  });

  it("skips a voided application in the cumulative maths", async () => {
    invoiceFindMany.mockResolvedValue([
      app({ applicationNumber: 1, amount: 9_000, lines: [{ sovLineId: "sov1", workCompleted: 10_000 }] }),
      app({ applicationNumber: 2, status: "VOID", amount: 9_000, lines: [{ sovLineId: "sov1", workCompleted: 10_000 }] }),
      app({ applicationNumber: 3, amount: 9_000, lines: [{ sovLineId: "sov1", workCompleted: 10_000 }] }),
    ]);
    const s = await getBillingSummary("job1");
    expect(s?.totals.completedToDate).toBe(20_000);
    expect(s?.applications[2].computed.previousCertificates).toBe(9_000);
  });

  it("flags a schedule that no longer adds up to the contract", async () => {
    sovFindMany.mockResolvedValue([
      { id: "sov1", itemNo: 1, description: "Drywall", scheduledValue: 830_000, sortOrder: 0 },
    ]);
    const s = await getBillingSummary("job1");
    expect(s?.sovMatchesContract).toBe(false);
  });
});

describe("createApplication", () => {
  const period = { periodTo: "2026-06-30" };

  it("refuses on a lump-sum job", async () => {
    jobFindUnique.mockResolvedValue({ ...progressJob, billingMethod: "LUMP_SUM" });
    const r = await createApplication("job1", { ...period, lines: [{ sovLineId: "sov1", workCompleted: 1 }] }, "u1");
    expect(r).toMatchObject({ ok: false, reason: "not_progress" });
    expect(invoiceCreate).not.toHaveBeenCalled();
  });

  it("refuses while a draft is open", async () => {
    invoiceFindMany.mockResolvedValue([app({ applicationNumber: 1, status: "DRAFT" })]);
    const r = await createApplication("job1", { ...period, lines: [{ sovLineId: "sov1", workCompleted: 1 }] }, "u1");
    expect(r).toMatchObject({ ok: false, reason: "draft_exists" });
  });

  it("refuses to bill past the scheduled value", async () => {
    invoiceFindMany.mockResolvedValue([
      app({ applicationNumber: 1, amount: 720_000, lines: [{ sovLineId: "sov1", workCompleted: 800_000 }] }),
    ]);
    const r = await createApplication("job1", { ...period, lines: [{ sovLineId: "sov1", workCompleted: 40_000 }] }, "u1");
    expect(r).toMatchObject({ ok: false, reason: "exceeds_scheduled_value" });
  });

  it("refuses a line that is not on the schedule, and an empty period", async () => {
    expect(await createApplication("job1", { ...period, lines: [{ sovLineId: "nope", workCompleted: 5 }] }, "u1"))
      .toMatchObject({ ok: false, reason: "unknown_line" });
    expect(await createApplication("job1", { ...period, lines: [{ sovLineId: "sov1", workCompleted: 0 }] }, "u1"))
      .toMatchObject({ ok: false, reason: "nothing_billed" });
  });

  it("creates app #13 for JOB-00009 with the derived amount and snapshotted rate", async () => {
    invoiceFindMany.mockResolvedValue(
      APPS.map(([n, gross, net]) =>
        app({ applicationNumber: n, status: n <= 9 ? "PAID" : "SENT", amount: net, lines: [{ sovLineId: "sov1", workCompleted: gross }] }),
      ),
    );
    const r = await createApplication(
      "job1",
      { periodFrom: "2026-04-01", periodTo: "2026-04-30", lines: [{ sovLineId: "sov1", workCompleted: 40_000 }], status: "SENT" },
      "u1",
    );
    expect(r).toMatchObject({ ok: true, amount: 36_000 });
    const data = invoiceCreate.mock.calls[0][0].data;
    expect(data.applicationNumber).toBe(13);
    expect(data.invoiceNumber).toBe("INV-00009-13");
    expect(data.retainagePercent).toBe(10);
    expect(data.status).toBe("SENT");
    expect(data.periodFrom.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(data.lines.create).toEqual([{ sovLineId: "sov1", workCompleted: 40_000 }]);
    expect(activityCreate).toHaveBeenCalledTimes(1);
  });

  it("drops zero lines and defaults the period start to the day after the last one", async () => {
    sovFindMany.mockResolvedValue([
      { id: "sov1", itemNo: 1, description: "Base", scheduledValue: 800_000, sortOrder: 0 },
      { id: "sov2", itemNo: 2, description: "CO#1", scheduledValue: 32_500, sortOrder: 1 },
    ]);
    invoiceFindMany.mockResolvedValue([
      app({ applicationNumber: 1, amount: 900, periodTo: new Date("2026-05-31T00:00:00Z"), lines: [{ sovLineId: "sov1", workCompleted: 1_000 }] }),
    ]);
    await createApplication("job1", { periodTo: "2026-06-30", lines: [{ sovLineId: "sov1", workCompleted: 100 }, { sovLineId: "sov2", workCompleted: 0 }] }, "u1");
    const data = invoiceCreate.mock.calls[0][0].data;
    expect(data.lines.create).toEqual([{ sovLineId: "sov1", workCompleted: 100 }]);
    expect(data.periodFrom.toISOString().slice(0, 10)).toBe("2026-06-01");
  });
});

describe("updateApplication", () => {
  it("only edits a draft, and only the latest one", async () => {
    invoiceFindUnique.mockResolvedValue({ id: "inv1", jobId: "job1", invoiceNumber: "INV-00009-1", status: "SENT", applicationNumber: 1, amount: 900 });
    expect(await updateApplication("inv1", { lines: [] })).toMatchObject({ ok: false, reason: "not_draft" });

    invoiceFindUnique.mockResolvedValue({ id: "inv1", jobId: "job1", invoiceNumber: "INV-00009-1", status: "DRAFT", applicationNumber: 1, amount: 900 });
    invoiceFindMany.mockResolvedValue([
      app({ applicationNumber: 1, status: "DRAFT", amount: 900, lines: [{ sovLineId: "sov1", workCompleted: 1_000 }] }),
      app({ applicationNumber: 2, amount: 900, lines: [{ sovLineId: "sov1", workCompleted: 1_000 }] }),
    ]);
    expect(await updateApplication("inv1", { lines: [] })).toMatchObject({ ok: false, reason: "not_latest" });

    invoiceFindUnique.mockResolvedValue({ id: "plain", jobId: "job1", invoiceNumber: "INV-00009-9", status: "DRAFT", applicationNumber: null, amount: 900 });
    expect(await updateApplication("plain", { lines: [] })).toMatchObject({ ok: false, reason: "not_application" });
  });

  it("replaces the lines and recomputes the amount", async () => {
    invoiceFindUnique.mockResolvedValue({ id: "inv2", jobId: "job1", invoiceNumber: "INV-00009-2", status: "DRAFT", applicationNumber: 2, amount: 1 });
    invoiceFindMany.mockResolvedValue([
      app({ applicationNumber: 1, status: "PAID", amount: 31_500, lines: [{ sovLineId: "sov1", workCompleted: 35_000 }] }),
      app({ applicationNumber: 2, status: "DRAFT", amount: 1, lines: [{ sovLineId: "sov1", workCompleted: 1 }] }),
    ]);
    const r = await updateApplication("inv2", { lines: [{ sovLineId: "sov1", workCompleted: 42_800 }], periodTo: "2025-05-31" });
    expect(r).toMatchObject({ ok: true, amount: 38_520 });
    expect(lineDeleteMany).toHaveBeenCalledWith({ where: { invoiceId: "inv2" } });
    expect(lineCreateMany.mock.calls[0][0].data).toEqual([{ invoiceId: "inv2", sovLineId: "sov1", workCompleted: 42_800 }]);
    expect(invoiceUpdate.mock.calls[0][0].data).toMatchObject({ amount: 38_520, retainagePercent: 10 });
  });
});

describe("canVoidApplication", () => {
  it("allows voiding only when nothing later is still standing", async () => {
    invoiceFindUnique.mockResolvedValue({ jobId: "job1", applicationNumber: 3 });
    invoiceCount.mockResolvedValue(1);
    expect(await canVoidApplication("inv3")).toBe(false);
    invoiceCount.mockResolvedValue(0);
    expect(await canVoidApplication("inv3")).toBe(true);
  });

  it("never blocks a plain invoice", async () => {
    invoiceFindUnique.mockResolvedValue({ jobId: "job1", applicationNumber: null });
    expect(await canVoidApplication("inv")).toBe(true);
    expect(invoiceCount).not.toHaveBeenCalled();
  });
});

describe("seedSovIfEmpty", () => {
  it("creates one line for the whole contract when the job has none", async () => {
    sovCount.mockResolvedValue(0);
    await seedSovIfEmpty("job1");
    expect(sovCreate.mock.calls[0][0].data).toMatchObject({
      jobId: "job1",
      itemNo: 1,
      description: "Towne Place Suites",
      scheduledValue: CONTRACT,
    });
  });

  it("leaves an existing schedule alone", async () => {
    sovCount.mockResolvedValue(2);
    await seedSovIfEmpty("job1");
    expect(sovCreate).not.toHaveBeenCalled();
  });
});

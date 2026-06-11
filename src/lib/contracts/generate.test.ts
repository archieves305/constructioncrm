import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/pdf/labor-contract", () => ({
  renderLaborContractPdf: vi.fn(async () => Buffer.from("%PDF-labor")),
}));
vi.mock("@/lib/pdf/contract-addendum", () => ({
  renderContractAddendumPdf: vi.fn(async () => Buffer.from("%PDF-addendum")),
}));
vi.mock("@/lib/files/storage", () => ({
  saveFile: vi.fn(async (_buf: Buffer, name: string) => ({
    storageKey: `2026-06/${name}`,
    bytes: 42,
  })),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    laborContract: { findFirst: vi.fn() },
    laborChangeOrder: { findUnique: vi.fn(), findMany: vi.fn() },
    generatedDocument: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    file: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import {
  generateLaborContractPdf,
  generateChangeOrderAddendumPdf,
  MissingFieldsError,
  buildLaborContractSnapshot,
  validateLaborContractFields,
  laborContractFileName,
  addendumFileName,
  type LeadLike,
} from "./generate";
import type { JobTypeKey } from "./types";

const JOB_ID = "job1";

function fakeLead(overrides: Partial<LeadLike> = {}): LeadLike {
  return {
    fullName: "Jane Owner",
    companyName: null,
    primaryPhone: "555-1212",
    secondaryPhone: null,
    email: "jane@example.com",
    propertyAddress1: "100 Main St",
    propertyAddress2: null,
    city: "Fort Lauderdale",
    state: "FL",
    zipCode: "33305",
    ...overrides,
  };
}

function fakeContract(
  jobType: JobTypeKey,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "lc1",
    label: null,
    contractAmount: 10000,
    description: "Frame and drywall the new addition.",
    paymentTerms: null,
    startDate: null,
    estimatedCompletionDate: null,
    contractorLicense: null,
    contractorInsurance: null,
    exclusions: null,
    crew: { name: "ABC Framing", phone: "555-9999", email: "abc@example.com" },
    job: {
      id: JOB_ID,
      leadId: "lead1",
      jobNumber: "J-1001",
      title: "Addition build",
      serviceType: "General Construction",
      jobType,
      lead: fakeLead(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(prisma.generatedDocument.count).mockReset().mockResolvedValue(0);
  vi.mocked(prisma.file.create)
    .mockReset()
    .mockResolvedValue({ id: "file1" } as never);
  vi.mocked(prisma.generatedDocument.create)
    .mockReset()
    .mockImplementation(
      ((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "gd1", ...args.data })) as never,
    );
  vi.mocked(prisma.laborContract.findFirst).mockReset();
  vi.mocked(prisma.laborChangeOrder.findUnique).mockReset();
});

function lastSnapshot() {
  const call = vi.mocked(prisma.generatedDocument.create).mock.calls.at(-1);
  return (call?.[0] as { data: { sourceDataSnapshot: Record<string, unknown> } })
    .data.sourceDataSnapshot as Record<string, unknown>;
}

describe("generateLaborContractPdf", () => {
  it.each([
    ["FIXED_PRICE", "Fixed Price"],
    ["OWNED_REHAB", "Owner / Owned-Rehab"],
    ["COST_PLUS", "Cost Plus"],
  ] as Array<[JobTypeKey, string]>)(
    "generates a v1 labor contract for %s jobs",
    async (jobType, label) => {
      vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
        fakeContract(jobType) as never,
      );

      const doc = (await generateLaborContractPdf(
        JOB_ID,
        "lc1",
        "user1",
      )) as Record<string, unknown>;

      expect(doc.versionNumber).toBe(1);
      expect(doc.documentType).toBe("LABOR_CONTRACT");
      expect(doc.fileName).toBe("labor-contract-j-1001-abc-framing-v1.pdf");

      // File record saved under the Labor Contract document category.
      expect(vi.mocked(prisma.file.create)).toHaveBeenCalledOnce();
      expect(
        vi.mocked(prisma.file.create).mock.calls[0][0].data.category,
      ).toBe("LABOR_CONTRACT");

      const snap = lastSnapshot() as {
        job: { jobType: string; jobTypeLabel: string };
        terms: { scopeOfWork: string };
      };
      expect(snap.job.jobType).toBe(jobType);
      expect(snap.job.jobTypeLabel).toBe(label);
      // Scope of Work carries the exact description verbatim.
      expect(snap.terms.scopeOfWork).toBe("Frame and drywall the new addition.");
    },
  );

  it("creates a new version when regenerating the same labor contract", async () => {
    vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
      fakeContract("FIXED_PRICE") as never,
    );
    // One contract PDF already exists for this contract.
    vi.mocked(prisma.generatedDocument.count).mockResolvedValue(1);

    const doc = (await generateLaborContractPdf(
      JOB_ID,
      "lc1",
      "user1",
    )) as Record<string, unknown>;

    expect(doc.versionNumber).toBe(2);
    expect(doc.fileName).toBe("labor-contract-j-1001-abc-framing-v2.pdf");
  });

  it("rejects generation when required fields are missing", async () => {
    vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
      fakeContract("FIXED_PRICE", { description: null }) as never,
    );

    await expect(
      generateLaborContractPdf(JOB_ID, "lc1", "user1"),
    ).rejects.toBeInstanceOf(MissingFieldsError);

    try {
      await generateLaborContractPdf(JOB_ID, "lc1", "user1");
    } catch (e) {
      expect((e as MissingFieldsError).fields).toContain("Scope / description");
    }
    // No PDF or document row should be created for an invalid contract.
    expect(vi.mocked(prisma.file.create)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.generatedDocument.create)).not.toHaveBeenCalled();
  });

  it("keeps each version's source snapshot independent of later edits", async () => {
    vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
      fakeContract("FIXED_PRICE", {
        description: "Original scope of work.",
      }) as never,
    );
    await generateLaborContractPdf(JOB_ID, "lc1", "user1");
    const snapV1 = lastSnapshot() as { terms: { scopeOfWork: string } };
    expect(snapV1.terms.scopeOfWork).toBe("Original scope of work.");

    // Simulate a later edit to the labor contract and regenerate.
    vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
      fakeContract("FIXED_PRICE", { description: "Edited scope." }) as never,
    );
    vi.mocked(prisma.generatedDocument.count).mockResolvedValue(1);
    await generateLaborContractPdf(JOB_ID, "lc1", "user1");
    const snapV2 = lastSnapshot() as { terms: { scopeOfWork: string } };

    expect(snapV2.terms.scopeOfWork).toBe("Edited scope.");
    // The first snapshot is unchanged by the later edit.
    expect(snapV1.terms.scopeOfWork).toBe("Original scope of work.");
  });
});

function fakeChangeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "co1",
    amount: 2500,
    reason: "Added a bathroom rough-in.",
    changeDate: new Date("2026-06-10T00:00:00.000Z"),
    changeNumber: 1,
    scopeChange: "Add one bathroom rough-in.",
    timeAdjustmentDays: 3,
    updatedPaymentTerms: null,
    laborContract: {
      id: "lc1",
      contractAmount: 10000,
      description: "Frame and drywall the new addition.",
      label: null,
      crew: { name: "ABC Framing", phone: "555-9999", email: "abc@example.com" },
      job: {
        id: JOB_ID,
        leadId: "lead1",
        jobNumber: "J-1001",
        title: "Addition build",
        serviceType: "General Construction",
        jobType: "FIXED_PRICE",
        lead: fakeLead(),
      },
    },
    ...overrides,
  };
}

describe("generateChangeOrderAddendumPdf", () => {
  it("generates a v1 addendum for a change order", async () => {
    vi.mocked(prisma.laborChangeOrder.findUnique).mockResolvedValue(
      fakeChangeOrder() as never,
    );

    const doc = (await generateChangeOrderAddendumPdf(
      JOB_ID,
      "co1",
      "user1",
    )) as Record<string, unknown>;

    expect(doc.versionNumber).toBe(1);
    expect(doc.documentType).toBe("CONTRACT_ADDENDUM");
    expect(doc.changeOrderId).toBe("co1");
    expect(doc.fileName).toBe(
      "contract-addendum-j-1001-change-order-1-v1.pdf",
    );
    expect(
      vi.mocked(prisma.file.create).mock.calls[0][0].data.category,
    ).toBe("CONTRACT_ADDENDUM");

    const snap = lastSnapshot() as {
      changeOrder: { priceAdjustment: number; changeNumber: number };
      originalContract: { contractAmount: number };
    };
    expect(snap.changeOrder.priceAdjustment).toBe(2500);
    expect(snap.changeOrder.changeNumber).toBe(1);
    expect(snap.originalContract.contractAmount).toBe(10000);
  });

  it("allows multiple addendum versions for the same change order", async () => {
    vi.mocked(prisma.laborChangeOrder.findUnique).mockResolvedValue(
      fakeChangeOrder() as never,
    );
    vi.mocked(prisma.generatedDocument.count).mockResolvedValue(1);

    const doc = (await generateChangeOrderAddendumPdf(
      JOB_ID,
      "co1",
      "user1",
    )) as Record<string, unknown>;

    expect(doc.versionNumber).toBe(2);
    expect(doc.fileName).toBe(
      "contract-addendum-j-1001-change-order-1-v2.pdf",
    );
  });
});

describe("pure helpers", () => {
  it("validateLaborContractFields lists every missing field", () => {
    const snap = buildLaborContractSnapshot({
      versionNumber: 1,
      generatedAt: new Date("2026-06-11T00:00:00.000Z"),
      job: {
        jobNumber: "J-1",
        title: "t",
        serviceType: "s",
        jobType: "FIXED_PRICE",
      },
      lead: fakeLead({ fullName: "", propertyAddress1: "" }),
      contractorName: "",
      contractor: { phone: null, email: null },
      contract: {
        contractAmount: 0,
        description: null,
        paymentTerms: null,
        startDate: null,
        estimatedCompletionDate: null,
        contractorLicense: null,
        contractorInsurance: null,
        exclusions: null,
      },
    });
    expect(validateLaborContractFields(snap)).toEqual([
      "Job owner / customer",
      "Job site address",
      "Labor contractor name",
      "Scope / description",
    ]);
  });

  it("builds the spec filename formats", () => {
    expect(laborContractFileName("J-1001", "ABC Framing", 3)).toBe(
      "labor-contract-j-1001-abc-framing-v3.pdf",
    );
    expect(addendumFileName("J-1001", 2, 4)).toBe(
      "contract-addendum-j-1001-change-order-2-v4.pdf",
    );
  });

  it("snapshot is immutable against mutation of source input", () => {
    const lead = fakeLead();
    const snap = buildLaborContractSnapshot({
      versionNumber: 1,
      generatedAt: new Date("2026-06-11T00:00:00.000Z"),
      job: {
        jobNumber: "J-1",
        title: "t",
        serviceType: "s",
        jobType: "COST_PLUS",
      },
      lead,
      contractorName: "Crew A",
      contractor: { phone: null, email: null },
      contract: {
        contractAmount: 5000,
        description: "Scope A",
        paymentTerms: null,
        startDate: null,
        estimatedCompletionDate: null,
        contractorLicense: null,
        contractorInsurance: null,
        exclusions: null,
      },
    });
    // Mutate the source after building — the snapshot must not change.
    lead.fullName = "Someone Else";
    expect(snap.owner.name).toBe("Jane Owner");
  });
});

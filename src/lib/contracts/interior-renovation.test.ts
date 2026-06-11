import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/pdf/labor-contract", () => ({
  renderLaborContractPdf: vi.fn(async () => Buffer.from("%PDF-labor")),
}));
vi.mock("@/lib/pdf/contract-addendum", () => ({
  renderContractAddendumPdf: vi.fn(async () => Buffer.from("%PDF-addendum")),
}));
vi.mock("@/lib/pdf/interior-renovation-contract", () => ({
  renderInteriorRenovationContractPdf: vi.fn(async () =>
    Buffer.from("%PDF-interior"),
  ),
}));
vi.mock("@/lib/files/storage", () => ({
  saveFile: vi.fn(async (_buf: Buffer, name: string) => ({
    storageKey: `2026-06/${name}`,
    bytes: 99,
  })),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    laborContract: { findFirst: vi.fn() },
    generatedDocument: { count: vi.fn(), create: vi.fn() },
    file: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import {
  generateInteriorRenovationLaborContractPdf,
  validateInteriorRenovationFields,
  buildInteriorRenovationSnapshot,
  interiorRenovationFileName,
  MissingFieldsError,
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

function fakeTask(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `t-${name}`,
    sortOrder: 0,
    name,
    room: "Kitchen",
    description: null,
    paymentAmount: 1000,
    paymentPercent: null,
    inspectionRequired: true,
    inspectionStatus: "PASSED",
    status: "COMPLETE",
    approvedBy: "PM",
    approvedDate: new Date("2026-06-05T00:00:00.000Z"),
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
    contractAmount: 25000,
    description: "Full interior remodel of kitchen and two bathrooms.",
    paymentTerms: null,
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    estimatedCompletionDate: new Date("2026-09-01T00:00:00.000Z"),
    contractorLicense: "CGC1500",
    contractorInsurance: "Acme GL",
    exclusions: "Appliances by Owner.",
    notes: "Owner on site weekdays.",
    retainagePercent: null,
    delayDamagesPerDay: null,
    crew: { name: "ABC Interiors", phone: "555-9999", email: "abc@x.com" },
    tasks: [fakeTask("Demolition"), fakeTask("Tile installation")],
    job: {
      leadId: "lead1",
      jobNumber: "J-2002",
      title: "Interior remodel",
      serviceType: "Interior Renovation",
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
});

function lastSnapshot() {
  const call = vi.mocked(prisma.generatedDocument.create).mock.calls.at(-1);
  return (call?.[0] as { data: { sourceDataSnapshot: Record<string, unknown> } })
    .data.sourceDataSnapshot as Record<string, unknown>;
}

describe("generateInteriorRenovationLaborContractPdf", () => {
  it.each([
    ["FIXED_PRICE", "Fixed Price"],
    ["OWNED_REHAB", "Owner / Owned-Rehab"],
    ["COST_PLUS", "Cost Plus"],
  ] as Array<[JobTypeKey, string]>)(
    "generates an interior contract for %s jobs",
    async (jobType, label) => {
      vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
        fakeContract(jobType) as never,
      );

      const doc = (await generateInteriorRenovationLaborContractPdf(
        JOB_ID,
        "lc1",
        "user1",
      )) as Record<string, unknown>;

      expect(doc.versionNumber).toBe(1);
      expect(doc.documentType).toBe("INTERIOR_RENOVATION_LABOR_CONTRACT");
      expect(doc.fileName).toBe(
        "interior-renovation-labor-contract-j-2002-abc-interiors-v1.pdf",
      );
      expect(
        vi.mocked(prisma.file.create).mock.calls[0][0].data.category,
      ).toBe("INTERIOR_RENOVATION_LABOR_CONTRACT");

      const snap = lastSnapshot() as {
        job: { jobType: string; jobTypeLabel: string };
        terms: { scopeOfWork: string; retainagePercent: number };
        tasks: Array<{ name: string }>;
      };
      expect(snap.job.jobType).toBe(jobType);
      expect(snap.job.jobTypeLabel).toBe(label);
      // Scope of Work carries the exact description.
      expect(snap.terms.scopeOfWork).toBe(
        "Full interior remodel of kitchen and two bathrooms.",
      );
      // Default 10% retainage applies when none set.
      expect(snap.terms.retainagePercent).toBe(10);
      // Task schedule is included in the snapshot.
      expect(snap.tasks.map((t) => t.name)).toEqual([
        "Demolition",
        "Tile installation",
      ]);
    },
  );

  it("creates a new version when regenerating", async () => {
    vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
      fakeContract("FIXED_PRICE") as never,
    );
    vi.mocked(prisma.generatedDocument.count).mockResolvedValue(2);

    const doc = (await generateInteriorRenovationLaborContractPdf(
      JOB_ID,
      "lc1",
      "user1",
    )) as Record<string, unknown>;

    expect(doc.versionNumber).toBe(3);
    expect(doc.fileName).toBe(
      "interior-renovation-labor-contract-j-2002-abc-interiors-v3.pdf",
    );
  });

  it("rejects when required fields are missing (no scope, amount, or start)", async () => {
    vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
      fakeContract("FIXED_PRICE", {
        description: null,
        contractAmount: 0,
        paymentTerms: null,
        startDate: null,
      }) as never,
    );

    await expect(
      generateInteriorRenovationLaborContractPdf(JOB_ID, "lc1", "user1"),
    ).rejects.toBeInstanceOf(MissingFieldsError);

    try {
      await generateInteriorRenovationLaborContractPdf(JOB_ID, "lc1", "user1");
    } catch (e) {
      expect((e as MissingFieldsError).fields).toEqual([
        "Scope / description",
        "Contract amount or payment terms",
        "Start date",
      ]);
    }
    expect(vi.mocked(prisma.file.create)).not.toHaveBeenCalled();
  });

  it("keeps each version's snapshot independent of later edits", async () => {
    vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
      fakeContract("FIXED_PRICE", { description: "Original scope." }) as never,
    );
    await generateInteriorRenovationLaborContractPdf(JOB_ID, "lc1", "user1");
    const v1 = lastSnapshot() as { terms: { scopeOfWork: string } };
    expect(v1.terms.scopeOfWork).toBe("Original scope.");

    vi.mocked(prisma.laborContract.findFirst).mockResolvedValue(
      fakeContract("FIXED_PRICE", { description: "Edited scope." }) as never,
    );
    vi.mocked(prisma.generatedDocument.count).mockResolvedValue(1);
    await generateInteriorRenovationLaborContractPdf(JOB_ID, "lc1", "user1");
    const v2 = lastSnapshot() as { terms: { scopeOfWork: string } };

    expect(v2.terms.scopeOfWork).toBe("Edited scope.");
    expect(v1.terms.scopeOfWork).toBe("Original scope.");
  });
});

describe("interior renovation pure helpers", () => {
  it("validateInteriorRenovationFields accepts payment terms in lieu of amount", () => {
    const base = buildInteriorRenovationSnapshot({
      versionNumber: 1,
      generatedAt: new Date("2026-06-11T00:00:00.000Z"),
      job: {
        jobNumber: "J-1",
        title: "t",
        serviceType: "s",
        jobType: "FIXED_PRICE",
      },
      lead: fakeLead(),
      contractorName: "Crew A",
      contractor: { phone: null, email: null },
      contract: {
        contractAmount: 0,
        description: "Scope",
        paymentTerms: "Weekly per approved task",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        estimatedCompletionDate: null,
        contractorLicense: null,
        contractorInsurance: null,
        exclusions: null,
        notes: null,
        retainagePercent: null,
        delayDamagesPerDay: null,
      },
      tasks: [],
    });
    expect(validateInteriorRenovationFields(base)).toEqual([]);
  });

  it("builds the spec interior filename format", () => {
    expect(interiorRenovationFileName("J-2002", "ABC Interiors", 2)).toBe(
      "interior-renovation-labor-contract-j-2002-abc-interiors-v2.pdf",
    );
  });
});

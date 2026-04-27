import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/generated/prisma/client", () => ({
  Prisma: { DbNull: { __dbNull: true } as const },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    exception: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { recordAudit } from "./record";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

describe("recordAudit", () => {
  beforeEach(() => {
    vi.mocked(prisma.auditEvent.create).mockReset().mockResolvedValue({} as never);
    vi.mocked(logger.exception).mockReset();
  });

  it("writes the event with all fields populated", async () => {
    await recordAudit({
      actorUserId: "u1",
      entityType: "Job",
      entityId: "j1",
      action: "update",
      before: { stage: "OPEN" },
      after: { stage: "WON" },
      ipAddress: "1.2.3.4",
      userAgent: "test",
    });

    expect(vi.mocked(prisma.auditEvent.create)).toHaveBeenCalledWith({
      data: {
        actorUserId: "u1",
        entityType: "Job",
        entityId: "j1",
        action: "update",
        beforeJson: { stage: "OPEN" },
        afterJson: { stage: "WON" },
        ipAddress: "1.2.3.4",
        userAgent: "test",
      },
    });
  });

  it("normalizes missing optional fields to null", async () => {
    await recordAudit({
      entityType: "Lead",
      entityId: "l1",
      action: "create",
    });

    expect(vi.mocked(prisma.auditEvent.create)).toHaveBeenCalledWith({
      data: {
        actorUserId: null,
        entityType: "Lead",
        entityId: "l1",
        action: "create",
        beforeJson: { __dbNull: true },
        afterJson: { __dbNull: true },
        ipAddress: null,
        userAgent: null,
      },
    });
  });

  it("converts bigint values inside before/after to strings (JSON-safe)", async () => {
    await recordAudit({
      entityType: "Expense",
      entityId: "e1",
      action: "update",
      after: { amountCents: BigInt("12345678901234567890") },
    });

    const call = vi.mocked(prisma.auditEvent.create).mock.calls[0][0];
    expect((call.data.afterJson as { amountCents: string }).amountCents).toBe(
      "12345678901234567890",
    );
  });

  it("never throws to the caller — DB failures are logged via logger.exception", async () => {
    vi.mocked(prisma.auditEvent.create).mockRejectedValue(new Error("db down"));

    await expect(
      recordAudit({ entityType: "Job", entityId: "j1", action: "create" }),
    ).resolves.toBeUndefined();

    expect(vi.mocked(logger.exception)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ where: "recordAudit", entityType: "Job", entityId: "j1" }),
    );
  });
});

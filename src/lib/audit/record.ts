import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "stage_change"
  | "assign"
  | "unassign"
  | "login"
  | "password_reset"
  | "role_change";

type AuditInput = {
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction | (string & {});
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        beforeJson: serialize(input.before),
        afterJson: serialize(input.after),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    logger.exception(err, {
      where: "recordAudit",
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
    });
  }
}

function serialize(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

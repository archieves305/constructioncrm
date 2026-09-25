import { recordAudit } from "@/lib/audit/record";

export type ViolationAuditEntity =
  | "CodeViolationCase"
  | "CodeViolationItem"
  | "CodeViolationHearing"
  | "CodeViolationInspection"
  | "CodeViolationFineEntry"
  | "CodeViolationExtension"
  | "CodeViolationCategory";

/**
 * Every material change on a case is audited with the actor, the previous
 * value, the new value and the reason. `AuditEvent` has no reason column,
 * so the reason travels inside `after`.
 */
export async function auditCase(input: {
  actorUserId: string | null;
  entityType: ViolationAuditEntity;
  entityId: string;
  action: `violation_${string}`;
  before?: unknown;
  after?: Record<string, unknown>;
  reason?: string | null;
}): Promise<void> {
  await recordAudit({
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    before: input.before,
    after: input.reason ? { ...(input.after ?? {}), reason: input.reason } : input.after,
  });
}

import type { PermitStatus } from "@/generated/prisma/client";
import { isPermitStatus } from "./rules";

/**
 * The plain fields of a new job permit, checked before anything is written
 * (`POST /api/jobs/[id]/permits`). Mirrors what `updatePermit` refuses on a
 * PATCH: a date that is not a date, a fee that is not an amount of zero or
 * more, a status that is not a permit status. Pure — tested on its own.
 */
export type PermitCreateInput = {
  municipality: string | null;
  status: PermitStatus;
  permitType: string | null;
  permitNumber: string | null;
  submittedDate: Date | null | undefined;
  expectedApprovalDate: Date | null;
  expirationDate: Date | null;
  approvedDate: Date | null;
  assignedUserId: string | null;
  inspectorName: string | null;
  permitFee: string | null;
  notes: string | null;
};

const LIMITS = { short: 200, notes: 5000 } as const;

const DATE_LABEL: Record<string, string> = {
  submittedDate: "Submitted date",
  expectedApprovalDate: "Expected approval date",
  expirationDate: "Expiration date",
  approvedDate: "Approved date",
};

export function readPermitCreate(body: unknown): { ok: true; value: PermitCreateInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "A JSON body is required" };
  const b = body as Record<string, unknown>;

  const text = (field: string, label: string, max: number = LIMITS.short): string | null => {
    const v = b[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" && typeof v !== "number") throw new Error(`${label} must be text`);
    const s = String(v).trim();
    if (s.length > max) throw new Error(`${label} must be at most ${max} characters`);
    return s || null;
  };
  const date = (field: string): Date | null | undefined => {
    const v = b[field];
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    if (typeof v !== "string") throw new Error(`${DATE_LABEL[field]} is not a date`);
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new Error(`${DATE_LABEL[field]} is not a date`);
    return d;
  };

  try {
    const municipality = text("municipality", "Jurisdiction");
    if (!municipality && !b.jurisdictionId) return { ok: false, error: "Choose or type the jurisdiction" };

    const rawStatus = b.status === undefined || b.status === null || b.status === "" ? "APPLIED" : b.status;
    if (!isPermitStatus(rawStatus)) return { ok: false, error: "Status is not a permit status" };

    let permitFee: string | null = null;
    if (b.permitFee !== undefined && b.permitFee !== null && b.permitFee !== "") {
      const n = typeof b.permitFee === "number" ? b.permitFee : typeof b.permitFee === "string" ? Number(b.permitFee.trim()) : NaN;
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Permit fee must be an amount of zero or more" };
      permitFee = n.toFixed(2);
    }

    const assigned = b.assignedUserId;
    if (assigned !== undefined && assigned !== null && typeof assigned !== "string") return { ok: false, error: "Coordinator is not valid" };

    return {
      ok: true,
      value: {
        municipality,
        status: rawStatus,
        permitType: text("permitType", "Permit type"),
        permitNumber: text("permitNumber", "Permit number"),
        submittedDate: date("submittedDate"),
        expectedApprovalDate: date("expectedApprovalDate") ?? null,
        expirationDate: date("expirationDate") ?? null,
        approvedDate: date("approvedDate") ?? null,
        assignedUserId: (assigned as string | null | undefined) || null,
        inspectorName: text("inspectorName", "Inspector name"),
        permitFee,
        notes: text("notes", "Notes", LIMITS.notes),
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

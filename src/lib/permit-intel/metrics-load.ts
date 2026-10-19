import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jobAccessWhere } from "@/lib/access/records";
import { permitMetrics } from "./metrics";

/** Permit Center's tiles over the permits the viewer may open. */
export async function loadPermitMetrics(viewer: { id: string; role: RoleName }, now: Date = new Date()) {
  const rows = await prisma.jobPermit.findMany({
    where: { job: jobAccessWhere(viewer) },
    select: {
      id: true,
      status: true,
      approvedDate: true,
      expirationDate: true,
      jurisdiction: { select: { reviewDaysTarget: true } },
      cycles: { select: { number: true, submittedAt: true, outcome: true } },
      correctionItems: { where: { status: { in: ["OPEN", "WAITING_THIRD_PARTY", "DISPUTED"] } }, select: { status: true, dueAt: true } },
      correctionNotices: { where: { status: "CONFIRMED" }, orderBy: { receivedAt: "desc" }, take: 1, select: { responseDueAt: true } },
    },
  });
  return permitMetrics(
    rows.map((p) => ({
      id: p.id,
      status: p.status,
      approvedDate: p.approvedDate,
      expirationDate: p.expirationDate,
      reviewDaysTarget: p.jurisdiction?.reviewDaysTarget ?? null,
      cycles: p.cycles,
      openItems: p.correctionItems,
      responseDueAt: p.status === "CORRECTIONS" ? (p.correctionNotices[0]?.responseDueAt ?? null) : null,
    })),
    now,
  );
}

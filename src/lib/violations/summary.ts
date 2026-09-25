import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { buildViolationListWhere, parseViolationListParams, type ViolationView } from "./query";

/**
 * The counts behind the sidebar badge and the landing tiles: one count per
 * queue, each through the same `buildViolationListWhere` the list uses, so
 * a tile's number always matches the list it opens.
 */
export async function loadViolationSummary(user: { id: string; role: RoleName }) {
  const now = new Date();
  const count = (view: ViolationView, extra = "") =>
    prisma.codeViolationCase.count({ where: buildViolationListWhere(parseViolationListParams(new URLSearchParams(`view=${view}${extra}`)), { user, now }) });
  const [open, overdue, dueSoon, mine, awaitingAgency, fresh, fines, unassigned, jurisdictions] = await Promise.all([
    count("all"),
    count("overdue"),
    count("due-soon"),
    count("mine"),
    count("awaiting-agency"),
    count("new"),
    count("fines"),
    count("all", "&caseManagerId=__unassigned"),
    prisma.codeViolationCase.findMany({ where: buildViolationListWhere(parseViolationListParams(new URLSearchParams("view=all")), { user, now }), distinct: ["jurisdiction"], select: { jurisdiction: true }, orderBy: { jurisdiction: "asc" } }),
  ]);
  return {
    open,
    overdue,
    dueSoon,
    mine,
    awaitingAgency,
    new: fresh,
    fines,
    unassigned,
    jurisdictions: jurisdictions.flatMap((j) => (j.jurisdiction ? [j.jurisdiction] : [])),
  };
}

export type ViolationSummary = Awaited<ReturnType<typeof loadViolationSummary>>;

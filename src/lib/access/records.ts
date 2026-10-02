import { NextResponse } from "next/server";
import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jobsInvolvingUserWhere, leadsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { canWriteLeads, canWriteProduction, isOwnOnlyRole } from "./roles";

/**
 * By-id guards for leads and jobs.
 *
 * The lists already narrow a sales rep or crew lead to the records they are
 * involved with; the by-id routes did not, so the same person could read or
 * edit any lead or job by its URL. These apply the list's rule to the record.
 * A record outside the viewer's scope answers 404, so ids cannot be probed.
 */
type Viewer = { id: string; role: RoleName };
type Mode = "read" | "write";

/** Leads this viewer may open: everything, or — for own-only roles — assigned to them, raised by them, or the customer of one of their jobs. */
export function leadAccessWhere(viewer: Viewer): Prisma.LeadWhereInput {
  if (!isOwnOnlyRole(viewer.role)) return {};
  return { OR: [leadsInvolvingUserWhere(viewer.id), { createdByUserId: viewer.id }] };
}

/** Jobs this viewer may open: everything, or — for own-only roles — the jobs they have a role on. */
export function jobAccessWhere(viewer: Viewer): Prisma.JobWhereInput {
  if (!isOwnOnlyRole(viewer.role)) return {};
  return jobsInvolvingUserWhere(viewer.id);
}

const forbidden = (message: string) => NextResponse.json({ error: message }, { status: 403 });
const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 });

const LEAD_WRITE_DENIED = "Your role cannot change leads.";
const PRODUCTION_WRITE_DENIED = "Your role cannot change jobs, permits or change orders.";

/** Null when allowed; otherwise the response to return. */
export async function guardLead(viewer: Viewer, leadId: string, mode: Mode): Promise<NextResponse | null> {
  if (mode === "write" && !canWriteLeads(viewer.role)) return forbidden(LEAD_WRITE_DENIED);
  if (!isOwnOnlyRole(viewer.role)) return null;
  const hit = await prisma.lead.findFirst({ where: { AND: [{ id: leadId }, leadAccessWhere(viewer)] }, select: { id: true } });
  return hit ? null : notFound("Lead");
}

export async function guardLeads(viewer: Viewer, leadIds: string[]): Promise<NextResponse | null> {
  if (!canWriteLeads(viewer.role)) return forbidden(LEAD_WRITE_DENIED);
  if (!isOwnOnlyRole(viewer.role)) return null;
  const ids = [...new Set(leadIds)];
  const n = await prisma.lead.count({ where: { AND: [{ id: { in: ids } }, leadAccessWhere(viewer)] } });
  return n === ids.length ? null : forbidden("Some of those leads are not yours to change.");
}

export async function guardJob(viewer: Viewer, jobId: string, mode: Mode): Promise<NextResponse | null> {
  if (mode === "write" && !canWriteProduction(viewer.role)) return forbidden(PRODUCTION_WRITE_DENIED);
  if (!isOwnOnlyRole(viewer.role)) return null;
  const hit = await prisma.job.findFirst({ where: { AND: [{ id: jobId }, jobAccessWhere(viewer)] }, select: { id: true } });
  return hit ? null : notFound("Job");
}

export async function guardJobs(viewer: Viewer, jobIds: string[]): Promise<NextResponse | null> {
  if (!canWriteProduction(viewer.role)) return forbidden(PRODUCTION_WRITE_DENIED);
  if (!isOwnOnlyRole(viewer.role)) return null;
  const ids = [...new Set(jobIds)];
  const n = await prisma.job.count({ where: { AND: [{ id: { in: ids } }, jobAccessWhere(viewer)] } });
  return n === ids.length ? null : forbidden("Some of those jobs are not yours to change.");
}

/** Role-only guard for production records addressed by their own id (a permit, an inspection, a change order). */
export function guardProductionWrite(viewer: Viewer): NextResponse | null {
  return canWriteProduction(viewer.role) ? null : forbidden(PRODUCTION_WRITE_DENIED);
}

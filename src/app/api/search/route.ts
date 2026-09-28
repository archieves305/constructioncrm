import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import { toSearchHits } from "@/lib/search/format";
import { buildSearchWheres } from "@/lib/search/query";
import { visibilityScopeFor } from "@/lib/workflows/visibility";

const TAKE = 5;

/** ⌘K: a few hits per kind, scoped exactly like the list pages. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const scope = await visibilityScopeFor(session.user);
  const where = buildSearchWheres(q, { user: { id: session.user.id, role: session.user.role }, now: new Date(), scope });
  const [jobs, leads, cases, prospects, tasks] = await Promise.all([
    prisma.job.findMany({ where: where.jobs, take: TAKE, orderBy: { updatedAt: "desc" }, select: { ...JOB_LABEL_SELECT, currentStage: { select: { name: true } } } }),
    prisma.lead.findMany({ where: where.leads, take: TAKE, orderBy: { updatedAt: "desc" }, select: { ...LEAD_LABEL_SELECT, primaryPhone: true, currentStage: { select: { name: true } } } }),
    prisma.codeViolationCase.findMany({ where: where.cases, take: TAKE, orderBy: { updatedAt: "desc" }, select: { id: true, caseNumber: true, title: true, status: true, lead: { select: LEAD_LABEL_SELECT } } }),
    prisma.prospect.findMany({ where: where.prospects, take: TAKE, orderBy: { createdAt: "desc" }, select: { id: true, propertyAddress1: true, city: true, ownerName: true } }),
    prisma.task.findMany({
      where: where.tasks,
      take: TAKE,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      select: { id: true, title: true, dueAt: true, status: true, job: { select: JOB_LABEL_SELECT }, lead: { select: LEAD_LABEL_SELECT }, violationCase: { select: { caseNumber: true } } },
    }),
  ]);
  return NextResponse.json({ hits: toSearchHits({ jobs, leads, cases, prospects, tasks }) });
}

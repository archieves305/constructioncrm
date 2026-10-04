import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJobDelete } from "@/lib/access/records";
import { jobDeletePlan, loadJobDeleteCounts } from "@/lib/jobs/delete";

/** What deleting this job would remove, and what stops it. Writes nothing. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const denied = guardJobDelete(session.user);
  if (denied) return denied;

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json(jobDeletePlan(await loadJobDeleteCounts(id)));
}

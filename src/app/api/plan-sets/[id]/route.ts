import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardPlanSet } from "@/lib/takeoff/route-guards";
import { deletePlanSet, getPlanSet, updatePlanSet } from "@/lib/takeoff/service";
import { patchPlanSetSchema } from "@/lib/takeoff/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardPlanSet(session.user, id, "read");
  if (denied) return denied;
  const set = await getPlanSet(id);
  return set ? NextResponse.json(set) : NextResponse.json({ error: "Plan set not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardPlanSet(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, patchPlanSetSchema);
  if (!body.ok) return body.response;
  if (body.data.jobId) {
    const set = await prisma.planSet.findUnique({ where: { id }, select: { leadId: true } });
    const job = await prisma.job.findFirst({ where: { id: body.data.jobId, leadId: set?.leadId }, select: { id: true } });
    if (!job) return badRequest("That job does not belong to this lead");
  }
  const updated = await updatePlanSet(id, body.data, session.user.id);
  return updated ? NextResponse.json(updated) : NextResponse.json({ error: "Plan set not found" }, { status: 404 });
}

/** Removes the set, its documents, sheets and derived files. ADMIN / MANAGER. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardPlanSet(session.user, id, "delete");
  if (denied) return denied;
  const removed = await deletePlanSet(id, session.user.id);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Plan set not found" }, { status: 404 });
}

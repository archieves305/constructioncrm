import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardLeadForTakeoff } from "@/lib/takeoff/route-guards";
import { createPlanSet, listPlanSets } from "@/lib/takeoff/service";
import { createPlanSetSchema } from "@/lib/takeoff/validation";

/** The plan sets on a lead. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const leadId = request.nextUrl.searchParams.get("leadId");
  if (!leadId) return badRequest("leadId is required");
  const denied = await guardLeadForTakeoff(session.user, leadId, "read");
  if (denied) return denied;
  return NextResponse.json(await listPlanSets(leadId));
}

/** Start a plan set on a lead (the documents are added to it one by one). */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const body = await validateBody(request, createPlanSetSchema);
  if (!body.ok) return body.response;
  const denied = await guardLeadForTakeoff(session.user, body.data.leadId, "write");
  if (denied) return denied;
  const lead = await prisma.lead.findUnique({ where: { id: body.data.leadId }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (body.data.jobId) {
    const job = await prisma.job.findFirst({ where: { id: body.data.jobId, leadId: body.data.leadId }, select: { id: true } });
    if (!job) return badRequest("That job does not belong to this lead");
  }
  const created = await createPlanSet({ leadId: body.data.leadId, jobId: body.data.jobId ?? null, name: body.data.name, userId: session.user.id });
  return NextResponse.json(created, { status: 201 });
}

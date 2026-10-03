import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { recordAudit } from "@/lib/audit/record";
import { PermitError, updatePermitInspection } from "@/lib/permits/service";

type Params = { params: Promise<{ id: string }> };

/** The inspection's job, guarded for the viewer; a response when it is missing or out of scope. */
async function guard(id: string, user: Parameters<typeof guardJob>[0]) {
  const insp = await prisma.jobPermitInspection.findUnique({ where: { id }, select: { type: true, result: true, permitId: true, permit: { select: { jobId: true } } } });
  if (!insp) return { denied: NextResponse.json({ error: "Inspection not found" }, { status: 404 }), insp: null };
  return { denied: await guardJob(user, insp.permit.jobId, "write"), insp };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const { denied } = await guard(id, session.user);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });

  try {
    // A pass, fail or conditional result is also the workflow step's result — see recordPermitInspectionResult.
    const r = await updatePermitInspection(id, body, session.user);
    return NextResponse.json({ ...r.inspection, workflow: r.workflow, permitClosed: r.permitClosed });
  } catch (err) {
    if (err instanceof PermitError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const { denied, insp } = await guard(id, session.user);
  if (denied) return denied;
  await prisma.jobPermitInspection.delete({ where: { id } });
  await recordAudit({ actorUserId: session.user.id, entityType: "JobPermitInspection", entityId: id, action: "delete", before: { type: insp?.type, result: insp?.result, permitId: insp?.permitId } });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { PermitError, updatePermit } from "@/lib/permits/service";
import { canWriteProduction } from "@/lib/access/roles";
import { canManagePermitSettings, canSubmitPermit } from "@/lib/permit-intel/access";
import { loadPermitDetail } from "@/lib/permit-intel/service";
import { permitInScope } from "@/lib/permit-intel/route";
import { isAiConfigured } from "@/lib/ai/client";

/** One permit's whole record: the permit, its parties, cycles and submissions, documents with the requirement checklist, tasks, inspections and history. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "read");
  if (scope.denied) return scope.denied;
  const detail = await loadPermitDetail(id);
  if (!detail) return NextResponse.json({ error: "Permit not found" }, { status: 404 });
  const canEdit = canWriteProduction(session.user.role);
  return NextResponse.json({
    ...detail,
    permissions: { canEdit, canSubmit: canEdit && canSubmitPermit(session.user, detail.permit), canManageSettings: canManagePermitSettings(session.user.role), aiReady: isAiConfigured() },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const found = await prisma.jobPermit.findUnique({ where: { id }, select: { jobId: true } });
  if (!found) return NextResponse.json({ error: "Permit not found" }, { status: 404 });
  const denied = await guardJob(session.user, found.jobId, "write");
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });

  try {
    return NextResponse.json(await updatePermit(id, body, session.user));
  } catch (err) {
    if (err instanceof PermitError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

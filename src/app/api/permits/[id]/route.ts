import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { PermitError, updatePermit } from "@/lib/permits/service";

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

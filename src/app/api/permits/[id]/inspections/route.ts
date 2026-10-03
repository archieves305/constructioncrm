import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { createPermitInspection, PermitError } from "@/lib/permits/service";

const notFound = () => NextResponse.json({ error: "Permit not found" }, { status: 404 });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const permit = await prisma.jobPermit.findUnique({ where: { id }, select: { jobId: true } });
  if (!permit) return notFound();
  const denied = await guardJob(session.user, permit.jobId, "read");
  if (denied) return denied;
  const inspections = await prisma.jobPermitInspection.findMany({
    where: { permitId: id },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    include: { task: { select: { id: true, title: true, status: true } } },
  });
  return NextResponse.json(inspections);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const permit = await prisma.jobPermit.findUnique({ where: { id }, select: { jobId: true } });
  if (!permit) return notFound();
  const denied = await guardJob(session.user, permit.jobId, "write");
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });

  try {
    const r = await createPermitInspection(id, body, session.user);
    return NextResponse.json({ ...r.inspection, workflow: r.workflow, permitClosed: r.permitClosed }, { status: 201 });
  } catch (err) {
    if (err instanceof PermitError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

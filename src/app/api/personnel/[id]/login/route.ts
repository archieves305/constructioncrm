import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { canManagePersonnel } from "@/lib/labor/roles";

/**
 * GET / PUT /api/personnel/[id]/login — the CRM login a worker signs in to
 * KNU Field with (Personnel.userId). Linking it puts the worker's crew's jobs
 * in their crew mode (the "on the job" rule reads crew membership through it).
 * The personnel managers decide; one login per worker; audited.
 */
type Params = { params: Promise<{ id: string }> };
const body = z.object({ userId: z.string().min(1).max(40).nullable() });

async function current(id: string) {
  const p = await prisma.personnel.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, userId: true, user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true, role: { select: { name: true } } } } },
  });
  return p;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePersonnel(session.user.role)) return forbidden("Only the office links a worker to a login.");
  const { id } = await params;
  const p = await current(id);
  if (!p) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  return NextResponse.json({ user: p.user ? { id: p.user.id, name: `${p.user.firstName} ${p.user.lastName}`.trim(), email: p.user.email, role: p.user.role.name, isActive: p.user.isActive } : null });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePersonnel(session.user.role)) return forbidden("Only the office links a worker to a login.");
  const { id } = await params;
  const p = await current(id);
  if (!p) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  const v = await validateBody(request, body);
  if (!v.ok) return v.response;
  const userId = v.data.userId;
  if (userId) {
    const user = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "That login is not an active CRM user." }, { status: 400 });
    const taken = await prisma.personnel.findFirst({ where: { userId, id: { not: id } }, select: { firstName: true, lastName: true } });
    if (taken) return NextResponse.json({ error: `That login is already linked to ${taken.firstName} ${taken.lastName}.` }, { status: 409 });
  }
  await prisma.personnel.update({ where: { id }, data: { userId } });
  await recordAudit({ actorUserId: session.user.id, entityType: "Personnel", entityId: id, action: "update", before: { userId: p.userId }, after: { userId } });
  const after = await current(id);
  return NextResponse.json({ user: after?.user ? { id: after.user.id, name: `${after.user.firstName} ${after.user.lastName}`.trim(), email: after.user.email, role: after.user.role.name, isActive: after.user.isActive } : null });
}

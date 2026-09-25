import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { canManageNurture } from "@/lib/nurture/access";
import { reopenNurtureForExhausted } from "@/lib/nurture/hooks";
import { nurtureContentSchema } from "@/lib/validators/nurture";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageNurture(session.user.role)) return forbidden();
  const { id } = await params;
  const before = await prisma.nurtureContent.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const v = await validateBody(request, nurtureContentSchema.partial());
  if (!v.ok) return v.response;
  const d = v.data;
  const row = await prisma.nurtureContent.update({
    where: { id },
    data: {
      ...(d.kind !== undefined ? { kind: d.kind } : {}),
      ...(d.step !== undefined ? { step: d.step } : {}),
      ...(d.subject !== undefined ? { subject: d.subject } : {}),
      ...(d.body !== undefined ? { body: d.body } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      // Any edit of the words marks the row as the admin's; the seeder then leaves it alone.
      ...(d.subject !== undefined || d.body !== undefined ? { editedAt: new Date() } : {}),
    },
  });
  if (row.kind === "NURTURE" && row.isActive && !before.isActive) await reopenNurtureForExhausted();
  await recordAudit({ actorUserId: session.user.id, entityType: "NurtureContent", entityId: id, action: "update", before: { subject: before.subject, isActive: before.isActive }, after: d });
  return NextResponse.json(row);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageNurture(session.user.role)) return forbidden();
  const { id } = await params;
  const row = await prisma.nurtureContent.findUnique({ where: { id }, select: { sentCount: true, subject: true } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.sentCount > 0) return NextResponse.json({ error: "This piece has been sent; deactivate it instead so the history stays readable" }, { status: 403 });
  await prisma.nurtureContent.delete({ where: { id } });
  await recordAudit({ actorUserId: session.user.id, entityType: "NurtureContent", entityId: id, action: "delete", before: { subject: row.subject } });
  return NextResponse.json({ ok: true });
}

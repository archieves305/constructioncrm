import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { canManageNurture, canViewNurture } from "@/lib/nurture/access";
import { reopenNurtureForExhausted } from "@/lib/nurture/hooks";
import { nurtureContentReorderSchema, nurtureContentSchema } from "@/lib/validators/nurture";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewNurture(session.user.role)) return forbidden();
  const rows = await prisma.nurtureContent.findMany({ orderBy: [{ kind: "asc" }, { step: "asc" }, { sortOrder: "asc" }] });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageNurture(session.user.role)) return forbidden();
  const v = await validateBody(request, nurtureContentSchema);
  if (!v.ok) return v.response;
  const last = await prisma.nurtureContent.findFirst({ where: { kind: v.data.kind }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.nurtureContent.create({
    data: { ...v.data, step: v.data.kind === "FOLLOW_UP" ? v.data.step : null, sortOrder: v.data.sortOrder ?? (last?.sortOrder ?? 0) + 10, editedAt: new Date() },
  });
  if (row.kind === "NURTURE" && row.isActive) await reopenNurtureForExhausted();
  await recordAudit({ actorUserId: session.user.id, entityType: "NurtureContent", entityId: row.id, action: "create", after: { kind: row.kind, subject: row.subject } });
  return NextResponse.json(row, { status: 201 });
}

/** PUT — reorder within a kind by the given id order. */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageNurture(session.user.role)) return forbidden();
  const v = await validateBody(request, nurtureContentReorderSchema);
  if (!v.ok) return v.response;
  await prisma.$transaction(v.data.ids.map((id, i) => prisma.nurtureContent.update({ where: { id }, data: { sortOrder: (i + 1) * 10 } })));
  return NextResponse.json({ ok: true });
}

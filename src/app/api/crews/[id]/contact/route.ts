import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { contactData, crewContactSchema } from "@/lib/crews/contact";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { validateBody } from "@/lib/validation/body";

/**
 * PATCH /api/crews/[id]/contact — the foreman's name, phone and language, the
 * contact guest links go to. The roles that run labor contracts may set it
 * (the rest of a crew record stays ADMIN / MANAGER).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, crewContactSchema);
  if (!v.ok) return v.response;
  const before = await prisma.crew.findUnique({ where: { id }, select: { id: true, foremanName: true, phone: true, language: true } });
  if (!before) return NextResponse.json({ error: "Crew not found" }, { status: 404 });
  const crew = await prisma.crew.update({ where: { id }, data: contactData(v.data), select: { id: true, name: true, foremanName: true, phone: true, language: true } });
  await recordAudit({ actorUserId: session.user.id, entityType: "Crew", entityId: id, action: "crew_contact_update", before, after: crew });
  return NextResponse.json(crew);
}

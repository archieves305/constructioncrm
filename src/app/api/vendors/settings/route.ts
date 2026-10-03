import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { validateBody } from "@/lib/validation/body";
import { canSetComplianceOwner, canViewVendors } from "@/lib/vendors/access";
import { complianceOwnerId } from "@/lib/vendors/alert-run";

const NAME = { id: true, firstName: true, lastName: true } as const;

/** Who gets vendor expiry tasks: the person chosen, and who it falls to today. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewVendors(session.user.role)) return forbidden();

  const [settings, effectiveId] = await Promise.all([
    prisma.vendorSettings.findUnique({ where: { id: "default" }, select: { complianceOwner: { select: { ...NAME, isActive: true } } } }),
    complianceOwnerId(),
  ]);
  const effective = effectiveId ? await prisma.user.findUnique({ where: { id: effectiveId }, select: NAME }) : null;
  return NextResponse.json({
    complianceOwner: settings?.complianceOwner ?? null,
    effectiveOwner: effective,
    canEdit: canSetComplianceOwner(session.user.role),
  });
}

const schema = z.object({ complianceOwnerUserId: z.string().max(60).nullable() });

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canSetComplianceOwner(session.user.role)) return forbidden();

  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const userId = v.data.complianceOwnerUserId || null;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    if (!user?.isActive) return badRequest("Choose an active user");
  }
  const before = await prisma.vendorSettings.findUnique({ where: { id: "default" }, select: { complianceOwnerUserId: true } });
  await prisma.vendorSettings.upsert({ where: { id: "default" }, create: { id: "default", complianceOwnerUserId: userId }, update: { complianceOwnerUserId: userId } });
  await recordAudit({ actorUserId: session.user.id, entityType: "VendorSettings", entityId: "default", action: "update", before, after: { complianceOwnerUserId: userId } });
  return NextResponse.json({ ok: true });
}

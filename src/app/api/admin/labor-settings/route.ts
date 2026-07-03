import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { laborSettingsSchema } from "@/lib/validation/labor";
import { getLaborSettings } from "@/lib/labor/settings";
import { recordAudit } from "@/lib/audit/record";

export async function GET() {
  try {
    await requireRole("ADMIN", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await getLaborSettings());
}

// OT policy changes only re-price future saves — stored entry hours/costs
// are snapshots and are not retroactively rewritten.
export async function PUT(request: NextRequest) {
  let session;
  try {
    session = await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const v = await validateBody(request, laborSettingsSchema);
  if (!v.ok) return v.response;

  const before = await getLaborSettings();
  const existing = await prisma.laborSettings.findFirst({ select: { id: true } });
  if (existing) {
    await prisma.laborSettings.update({
      where: { id: existing.id },
      data: { ...v.data, updatedByUserId: session.user.id },
    });
  } else {
    await prisma.laborSettings.create({
      data: { ...v.data, updatedByUserId: session.user.id },
    });
  }

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "LaborSettings",
    entityId: existing?.id ?? "singleton",
    action: "update",
    before,
    after: v.data,
  });

  return NextResponse.json(await getLaborSettings());
}

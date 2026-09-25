import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { isEmailConfigured } from "@/lib/email/send";
import { canManageNurture, canViewNurture } from "@/lib/nurture/access";
import { recomputeAllSchedules } from "@/lib/nurture/hooks";
import { loadNurtureSettings } from "@/lib/nurture/settings";
import { nurtureSettingsSchema } from "@/lib/validators/nurture";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewNurture(session.user.role)) return forbidden();
  const [settings, stages, counts] = await Promise.all([
    loadNurtureSettings(),
    prisma.leadStage.findMany({ where: { isClosed: false }, orderBy: { stageOrder: "asc" }, select: { id: true, name: true } }),
    prisma.leadNurtureState.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return NextResponse.json({
    settings,
    envEnabled: env.NURTURE_ENABLED === "1",
    emailConfigured: isEmailConfigured(),
    maxPerRun: Number(env.NURTURE_MAX_PER_RUN) || 50,
    stages,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageNurture(session.user.role)) return forbidden();
  const v = await validateBody(request, nurtureSettingsSchema);
  if (!v.ok) return v.response;
  const before = await loadNurtureSettings();
  const settings = await prisma.nurtureSettings.update({ where: { id: "default" }, data: { ...v.data, updatedByUserId: session.user.id } });
  const recomputed = await recomputeAllSchedules();
  await recordAudit({ actorUserId: session.user.id, entityType: "NurtureSettings", entityId: "default", action: "update", before, after: v.data });
  return NextResponse.json({ settings, recomputed });
}

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { isZylowConfigured } from "@/lib/services/zylow/client";
import { getSettings } from "@/lib/services/canvassing/repository";
import { canvassingSettingsSchema } from "@/lib/validators/canvassing";

// Admin → Canvassing settings. GET seeds + returns the singleton plus the
// property-API configuration status (the key itself stays in server env and is
// never exposed). PUT replaces the full per-rule scoring config + toggles.
export async function GET() {
  try {
    await requireRole("ADMIN", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await getSettings();
  return NextResponse.json({
    scoringConfig: settings.scoringConfig,
    minPriorityScore: settings.minPriorityScore,
    showAbsenteeOwners: settings.showAbsenteeOwners,
    hideLowScoreProperties: settings.hideLowScoreProperties,
    cacheTtlDays: settings.cacheTtlDays,
    defaultOpeningScript: settings.defaultOpeningScript,
    complianceDisclaimer: settings.complianceDisclaimer,
    propertyApiConfigured: isZylowConfigured(),
  });
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const v = await validateBody(req, canvassingSettingsSchema);
  if (!v.ok) return v.response;
  const d = v.data;

  const data = {
    scoringConfigJson: d.scoringConfig as unknown as Prisma.InputJsonValue,
    minPriorityScore: d.minPriorityScore,
    showAbsenteeOwners: d.showAbsenteeOwners,
    hideLowScoreProperties: d.hideLowScoreProperties,
    cacheTtlDays: d.cacheTtlDays,
    defaultOpeningScript: d.defaultOpeningScript,
    complianceDisclaimer: d.complianceDisclaimer,
  };

  const updated = await prisma.canvassingSettings.upsert({
    where: { id: "default" },
    update: data,
    create: { id: "default", ...data },
  });

  return NextResponse.json({ ok: true, updatedAt: updated.updatedAt });
}

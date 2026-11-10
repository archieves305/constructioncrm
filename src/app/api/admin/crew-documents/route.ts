import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { FileCategory } from "@/generated/prisma/enums";
import { allowedCrewCategories, crewFileCategories, NEVER_CREW_BY_KIND } from "@/lib/files/crew-visibility";

/**
 * GET / PUT /api/admin/crew-documents — the kinds of job file crews may open
 * (Richard's ruling P-6: an admin decides). Read by ADMIN and MANAGER;
 * changed by ADMIN, audited. The always-private kinds are refused.
 */
const body = z.object({ categories: z.array(z.enum(Object.values(FileCategory) as [FileCategory, ...FileCategory[]])).max(30) });

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!["ADMIN", "MANAGER"].includes(session.user.role)) return forbidden();
  return NextResponse.json({ categories: await crewFileCategories(), neverShown: NEVER_CREW_BY_KIND });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role !== "ADMIN") return forbidden("Only an admin can change what crews see.");
  const v = await validateBody(request, body);
  if (!v.ok) return v.response;
  const refused = v.data.categories.filter((c) => NEVER_CREW_BY_KIND.includes(c));
  if (refused.length) return NextResponse.json({ error: `Crews never see these kinds of file: ${refused.join(", ")}. Show one file on its own instead.` }, { status: 400 });

  const before = await crewFileCategories();
  const categories = allowedCrewCategories(v.data.categories);
  const existing = await prisma.laborSettings.findFirst({ select: { id: true } });
  if (existing) await prisma.laborSettings.update({ where: { id: existing.id }, data: { crewFileCategories: v.data.categories, updatedByUserId: session.user.id } });
  else await prisma.laborSettings.create({ data: { crewFileCategories: v.data.categories, updatedByUserId: session.user.id } });
  await recordAudit({ actorUserId: session.user.id, entityType: "LaborSettings", entityId: existing?.id ?? "singleton", action: "update", before: { crewFileCategories: before }, after: { crewFileCategories: categories } });
  return NextResponse.json({ categories: await crewFileCategories(), neverShown: NEVER_CREW_BY_KIND });
}

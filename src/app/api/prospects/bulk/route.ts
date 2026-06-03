import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { bulkCreateProspectSchema } from "@/lib/validators/prospect";
import { Prisma } from "@/generated/prisma/client";

// Save many properties as prospects at once (from the property map/list).
// Deduped by reapiId so re-saving the same property is a no-op. Returns the
// prospect ids (existing + newly created) so the caller can immediately add
// them to a route.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  const parsed = bulkCreateProspectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }
  const { prospects } = parsed.data;

  const reapiIds = prospects
    .map((p) => p.reapiId)
    .filter((v): v is string => Boolean(v));

  const existing = reapiIds.length
    ? await prisma.prospect.findMany({
        where: { reapiId: { in: reapiIds } },
        select: { id: true, reapiId: true },
      })
    : [];
  const existingByReapi = new Map(existing.map((p) => [p.reapiId, p.id]));

  const ids: string[] = [];
  let created = 0;

  for (const p of prospects) {
    const hit = p.reapiId ? existingByReapi.get(p.reapiId) : undefined;
    if (hit) {
      ids.push(hit);
      continue;
    }
    const data: Prisma.ProspectUncheckedCreateInput = {
      reapiId: p.reapiId,
      ownerName: p.ownerName,
      propertyAddress1: p.propertyAddress1,
      propertyAddress2: p.propertyAddress2,
      city: p.city,
      state: p.state,
      zipCode: p.zipCode,
      county: p.county,
      latitude: p.latitude,
      longitude: p.longitude,
      notes: p.notes,
      createdByUserId: session.user.id,
      assignedToUserId: p.assignedToUserId ?? session.user.id,
    };
    const row = await prisma.prospect.create({ data, select: { id: true, reapiId: true } });
    if (row.reapiId) existingByReapi.set(row.reapiId, row.id); // dedupe within this batch too
    ids.push(row.id);
    created++;
  }

  return NextResponse.json({ ids, created, existing: ids.length - created }, { status: 201 });
}

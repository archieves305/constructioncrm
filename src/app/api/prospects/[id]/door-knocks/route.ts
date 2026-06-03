import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { createDoorKnockSchema } from "@/lib/validators/door-knock";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id: prospectId } = await params;

  const knocks = await prisma.propertyDoorKnock.findMany({
    where: { prospectId, isDeleted: false },
    include: {
      knockedBy: { select: { id: true, firstName: true, lastName: true } },
      photos: {
        select: { id: true, fileName: true, storageKey: true, category: true },
      },
    },
    orderBy: { knockedAt: "desc" },
  });

  const knocksWithCount = knocks.map((knock) => ({
    ...knock,
    photoCount: knock.photos.length,
  }));

  return NextResponse.json(knocksWithCount);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id: prospectId } = await params;
  const body = await request.json();
  const parsed = createDoorKnockSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }
  const input = parsed.data;

  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  const knock = await prisma.propertyDoorKnock.create({
    data: {
      prospectId,
      outcome: input.outcome,
      notes: input.notes,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      knockedAt: input.knockedAt ? new Date(input.knockedAt) : new Date(),
      knockedByUserId: session.user.id,
    },
    include: {
      knockedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // First contact moves a fresh prospect along the funnel.
  if (prospect.status === "NEW") {
    await prisma.prospect.update({
      where: { id: prospectId },
      data: { status: "CONTACTED" },
    });
  }

  return NextResponse.json(knock, { status: 201 });
}

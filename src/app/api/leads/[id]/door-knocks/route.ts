import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { createDoorKnockSchema } from "@/lib/validators/door-knock";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id: leadId } = await params;

  const knocks = await prisma.propertyDoorKnock.findMany({
    where: {
      leadId,
      isDeleted: false,
    },
    include: {
      knockedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      photos: {
        select: {
          id: true,
          fileName: true,
          storageKey: true,
          category: true,
        },
      },
    },
    orderBy: {
      knockedAt: "desc",
    },
  });

  // Add photo count to each knock
  const knocksWithCount = knocks.map((knock) => ({
    ...knock,
    photoCount: knock.photos.length,
  }));

  return NextResponse.json(knocksWithCount);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id: leadId } = await params;
  const body = await request.json();
  const parsed = createDoorKnockSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const input = parsed.data;

  // Validate the lead exists
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const knock = await prisma.propertyDoorKnock.create({
    data: {
      leadId,
      outcome: input.outcome,
      notes: input.notes,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      knockedAt: input.knockedAt ? new Date(input.knockedAt) : new Date(),
      knockedByUserId: session.user.id,
    },
    include: {
      knockedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      leadId,
      activityType: "NOTE",
      title: `Door knock logged: ${input.outcome.replace(/_/g, " ")}`,
      description: input.notes,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(knock, { status: 201 });
}

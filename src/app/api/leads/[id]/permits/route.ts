import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;

  const permits = await prisma.permit.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(permits);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();

  if (!body.addressNormalized || !body.municipality) {
    return badRequest("addressNormalized and municipality are required");
  }

  const permit = await prisma.permit.create({
    data: {
      leadId: id,
      addressNormalized: body.addressNormalized,
      municipality: body.municipality,
      sourceSystem: body.sourceSystem || "manual",
      permitNumber: body.permitNumber,
      permitType: body.permitType,
      permitDescription: body.permitDescription,
      permitStatus: body.permitStatus || "UNKNOWN",
      contractorName: body.contractorName,
      ownerName: body.ownerName,
      issueDate: body.issueDate ? new Date(body.issueDate) : null,
      finalDate: body.finalDate ? new Date(body.finalDate) : null,
    },
  });

  await prisma.activityLog.create({
    data: {
      leadId: id,
      activityType: "PERMIT_ADDED",
      title: `Permit record added: ${body.permitNumber || "N/A"}`,
      description: body.permitDescription,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(permit, { status: 201 });
}

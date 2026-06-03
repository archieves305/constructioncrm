import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { updateProspectSchema } from "@/lib/validators/prospect";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;

  const prospect = await prisma.prospect.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      lead: { select: { id: true, fullName: true } },
      knocks: {
        where: { isDeleted: false },
        orderBy: { knockedAt: "desc" },
        include: {
          knockedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  return NextResponse.json(prospect);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();
  const parsed = updateProspectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const prospect = await prisma.prospect.update({
    where: { id },
    data: parsed.data,
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(prospect);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  // Cascades to the prospect's knocks and route stops.
  await prisma.prospect.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

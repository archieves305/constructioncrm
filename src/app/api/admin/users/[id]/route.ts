import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole, badRequest } from "@/lib/auth/helpers";
import bcrypt from "bcryptjs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const updateData: Record<string, unknown> = {};
  if (body.firstName) updateData.firstName = body.firstName;
  if (body.lastName) updateData.lastName = body.lastName;
  if (body.email) updateData.email = body.email;
  if (body.roleId) updateData.roleId = body.roleId;
  if (typeof body.isActive === "boolean") updateData.isActive = body.isActive;
  if (body.password) updateData.passwordHash = await bcrypt.hash(body.password, 12);

  if (Object.keys(updateData).length === 0) {
    return badRequest("No fields to update");
  }

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    include: { role: true },
  });

  const { passwordHash: _, ...safeUser } = user;
  return NextResponse.json(safeUser);
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { requireRole, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { validatePassword } from "@/lib/auth/password-policy";

const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    roleId: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

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
  const v = await validateBody(request, updateUserSchema);
  if (!v.ok) return v.response;
  const body = v.data;

  const updateData: Record<string, unknown> = {};
  if (body.firstName !== undefined) updateData.firstName = body.firstName;
  if (body.lastName !== undefined) updateData.lastName = body.lastName;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.roleId !== undefined) updateData.roleId = body.roleId;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  if (body.password !== undefined) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return badRequest("User not found");

    const policy = validatePassword(body.password, [
      body.email ?? existing.email,
      body.firstName ?? existing.firstName,
      body.lastName ?? existing.lastName,
    ]);
    if (!policy.ok) {
      return NextResponse.json(
        { error: policy.reason, suggestions: policy.suggestions },
        { status: 400 },
      );
    }
    updateData.passwordHash = await bcrypt.hash(body.password, 12);
  }

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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { requireRole, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { validatePassword } from "@/lib/auth/password-policy";
import { recordAudit } from "@/lib/audit/record";

async function isLastAdmin(userId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  if (target?.role?.name !== "ADMIN" || !target.isActive) return false;
  const activeAdmins = await prisma.user.count({
    where: { isActive: true, role: { name: "ADMIN" } },
  });
  return activeAdmins <= 1;
}

const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    roleId: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(1).optional(),
    canViewSensitivePersonnel: z.boolean().optional(),
    canEditPayRates: z.boolean().optional(),
    canViewPayrollReports: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const v = await validateBody(request, updateUserSchema);
  if (!v.ok) return v.response;
  const body = v.data;

  // Prevent an admin from locking the team out: if this is the last active
  // admin, block role demotion + deactivation on this user.
  if (
    (body.roleId !== undefined || body.isActive === false) &&
    (await isLastAdmin(id))
  ) {
    // Only block if the change would actually strip the ADMIN role.
    if (body.isActive === false) {
      return badRequest(
        "Cannot deactivate the last remaining admin. Promote another user to ADMIN first.",
      );
    }
    if (body.roleId !== undefined) {
      const newRole = await prisma.role.findUnique({ where: { id: body.roleId } });
      if (newRole && newRole.name !== "ADMIN") {
        return badRequest(
          "Cannot demote the last remaining admin. Promote another user to ADMIN first.",
        );
      }
    }
  }

  // Self-demotion guard: an admin can change their own profile but should not
  // remove their own ADMIN role in a single request (forces deliberate handoff).
  if (session.user.id === id && body.roleId !== undefined) {
    const newRole = await prisma.role.findUnique({ where: { id: body.roleId } });
    if (newRole && newRole.name !== "ADMIN") {
      return badRequest(
        "You cannot remove your own ADMIN role. Ask another admin to do it.",
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.firstName !== undefined) updateData.firstName = body.firstName;
  if (body.lastName !== undefined) updateData.lastName = body.lastName;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.roleId !== undefined) updateData.roleId = body.roleId;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  // Field-module grants (SSN/doc access, pay-rate edits, payroll reports).
  // ADMIN-only route; every change is audited below.
  const GRANT_KEYS = [
    "canViewSensitivePersonnel",
    "canEditPayRates",
    "canViewPayrollReports",
  ] as const;
  const grantChanges: Record<string, boolean> = {};
  for (const key of GRANT_KEYS) {
    if (body[key] !== undefined) {
      updateData[key] = body[key];
      grantChanges[key] = body[key]!;
    }
  }

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

  const before =
    Object.keys(grantChanges).length > 0
      ? await prisma.user.findUnique({
          where: { id },
          select: {
            canViewSensitivePersonnel: true,
            canEditPayRates: true,
            canViewPayrollReports: true,
          },
        })
      : null;

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    include: { role: true },
  });

  if (before) {
    await recordAudit({
      actorUserId: session.user.id,
      entityType: "User",
      entityId: id,
      action: "grant_change",
      before,
      after: grantChanges,
    });
  }

  const { passwordHash: _, ...safeUser } = user;
  return NextResponse.json(safeUser);
}

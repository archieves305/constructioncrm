import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/helpers";

/**
 * Every CRM user with role and grants, for the admin Users page.
 *
 * Read-only: CareyOS is the identity provider, so users are created there
 * and appear here on their first sign-in. Roles, active flag and the
 * field-module grants are edited through PATCH /api/admin/users/[id].
 * Pickers should use /api/users/assignable, which any signed-in user may
 * read.
 */
export async function GET() {
  try {
    await requireRole("ADMIN", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    include: { role: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    users.map(({ passwordHash: _pw, ...user }) => user)
  );
}

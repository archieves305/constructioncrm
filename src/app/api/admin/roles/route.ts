import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/helpers";
import {
  SELECTABLE_ROLES,
  roleDisplayName,
  roleDescription,
} from "@/lib/auth/role-display";

export async function GET() {
  try {
    await requireRole("ADMIN", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roles = await prisma.role.findMany({
    where: { name: { in: SELECTABLE_ROLES } },
  });

  const rank = new Map(SELECTABLE_ROLES.map((n, i) => [n, i]));
  const sorted = roles
    .map((r) => ({
      id: r.id,
      name: r.name,
      displayName: roleDisplayName(r.name),
      description: roleDescription(r.name),
    }))
    .sort((a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99));

  return NextResponse.json(sorted);
}

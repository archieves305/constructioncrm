import type { Prisma, RoleName } from "@/generated/prisma/client";

/** Sales reps only see prospects assigned to them; everyone else sees all. */
export function prospectVisibilityWhere(user: { id: string; role: RoleName }): Prisma.ProspectWhereInput {
  return user.role === "SALES_REP" ? { assignedToUserId: user.id } : {};
}

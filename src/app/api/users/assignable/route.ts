import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

/**
 * Active users, for pickers.
 *
 * `/api/admin/users` is ADMIN/MANAGER only, which meant every assignee
 * dropdown silently broke for office staff and sales reps. Anyone signed in
 * may assign a task, so anyone signed in may see who can be assigned one.
 * Names and role only — no emails, no grants.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, isActive: true, role: { select: { name: true } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  return NextResponse.json(users);
}

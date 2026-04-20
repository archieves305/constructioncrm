import { getServerSession } from "next-auth";
import { authOptions } from "./options";
import type { RoleName } from "@/generated/prisma/client";
import { NextResponse } from "next/server";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireRole(...roles: RoleName[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    throw new Error("Forbidden");
  }
  return session;
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const ROLE_HIERARCHY: Record<RoleName, number> = {
  ADMIN: 100,
  MANAGER: 80,
  SALES_REP: 60,
  OFFICE_STAFF: 50,
  MARKETING: 40,
  READ_ONLY: 10,
};

export function hasMinRole(userRole: RoleName, requiredRole: RoleName): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { SessionUser } from "@/lib/auth/helpers";
import { permitInScope } from "./route";

/** A product on a permit, reached through its permit (and so its job's guard). */
export async function productInScope(user: SessionUser, id: string, mode: "read" | "write") {
  const row = await prisma.permitProduct.findUnique({ where: { id }, select: { permitId: true } });
  if (!row) return { permit: null, denied: NextResponse.json({ error: "Product not found on the permit" }, { status: 404 }) } as const;
  return permitInScope(user, row.permitId, mode);
}

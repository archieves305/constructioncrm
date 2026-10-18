import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { SessionUser } from "@/lib/auth/helpers";
import { permitInScope } from "./route";

/** A filled form, reached through its permit (and so its job's guard). */
export async function fillInScope(user: SessionUser, fillId: string, mode: "read" | "write") {
  const row = await prisma.permitFormFill.findUnique({ where: { id: fillId }, select: { permitId: true } });
  if (!row) return { permit: null, denied: NextResponse.json({ error: "Form not found" }, { status: 404 }) } as const;
  return permitInScope(user, row.permitId, mode);
}

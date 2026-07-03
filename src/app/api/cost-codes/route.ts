import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { costCodeSchema } from "@/lib/validation/labor";

const MANAGE_ROLES = new Set(["ADMIN", "MANAGER"]);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const activeOnly = request.nextUrl.searchParams.get("activeOnly") === "true";
  const codes = await prisma.costCode.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return NextResponse.json(codes);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!MANAGE_ROLES.has(session.user.role)) return forbidden();

  const v = await validateBody(request, costCodeSchema);
  if (!v.ok) return v.response;

  const existing = await prisma.costCode.findUnique({ where: { code: v.data.code } });
  if (existing) return badRequest(`Cost code ${v.data.code} already exists`);

  const code = await prisma.costCode.create({ data: v.data });
  return NextResponse.json(code, { status: 201 });
}

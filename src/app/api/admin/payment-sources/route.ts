import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  isActive: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const activeOnly = request.nextUrl.searchParams.get("activeOnly") === "true";
  const sources = await prisma.paymentSource.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(sources);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!["ADMIN", "MANAGER"].includes(session.user.role)) return forbidden();

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const source = await prisma.paymentSource
    .create({ data: { name: parsed.data.name.trim(), isActive: parsed.data.isActive ?? true } })
    .catch((e: { code?: string }) => {
      if (e.code === "P2002") return null;
      throw e;
    });
  if (!source) return badRequest("A payment source with that name already exists");
  return NextResponse.json(source, { status: 201 });
}

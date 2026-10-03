import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().or(z.literal("")).optional(),
  trades: z.array(z.string().min(1).max(80)).optional(),
  counties: z.array(z.string().min(1).max(80)).optional(),
  isActive: z.boolean().optional(),
  // The vendor record this crew belongs to; null unlinks it.
  vendorId: z.string().max(60).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone || null;
  if (parsed.data.email !== undefined) data.email = parsed.data.email || null;
  if (parsed.data.trades !== undefined) data.trades = parsed.data.trades;
  if (parsed.data.counties !== undefined) data.counties = parsed.data.counties;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.vendorId !== undefined) {
    if (parsed.data.vendorId) {
      const vendor = await prisma.vendor.findUnique({ where: { id: parsed.data.vendorId }, select: { id: true } });
      if (!vendor) return badRequest("That vendor no longer exists");
    }
    data.vendorId = parsed.data.vendorId || null;
  }

  const crew = await prisma.crew.update({ where: { id }, data });
  return NextResponse.json(crew);
}

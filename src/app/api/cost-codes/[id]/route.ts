import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { costCodeSchema } from "@/lib/validation/labor";

type Context = { params: Promise<{ id: string }> };

const MANAGE_ROLES = new Set(["ADMIN", "MANAGER"]);

export async function PATCH(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!MANAGE_ROLES.has(session.user.role)) return forbidden();

  const { id } = await context.params;
  const v = await validateBody(request, costCodeSchema.partial());
  if (!v.ok) return v.response;

  const existing = await prisma.costCode.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (v.data.code && v.data.code !== existing.code) {
    const clash = await prisma.costCode.findUnique({ where: { code: v.data.code } });
    if (clash) return badRequest(`Cost code ${v.data.code} already exists`);
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v.data)) {
    if (value !== undefined) data[key] = value;
  }
  const updated = await prisma.costCode.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// Referenced codes deactivate instead of deleting (history keeps its FK).
export async function DELETE(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!MANAGE_ROLES.has(session.user.role)) return forbidden();

  const { id } = await context.params;
  const existing = await prisma.costCode.findUnique({
    where: { id },
    include: { _count: { select: { laborEntries: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (existing._count.laborEntries > 0) {
    const updated = await prisma.costCode.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ ...updated, deactivated: true });
  }

  await prisma.costCode.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

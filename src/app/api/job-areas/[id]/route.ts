import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { jobAreaSchema } from "@/lib/validation/labor";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const area = await prisma.jobArea.findUnique({ where: { id } });
  if (!area) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(area.jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, jobAreaSchema.partial());
  if (!v.ok) return v.response;

  if (v.data.name && v.data.name !== area.name) {
    const clash = await prisma.jobArea.findUnique({
      where: { jobId_name: { jobId: area.jobId, name: v.data.name } },
    });
    if (clash) return badRequest(`Area "${v.data.name}" already exists on this job`);
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v.data)) {
    if (value !== undefined) data[key] = value;
  }
  const updated = await prisma.jobArea.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  const area = await prisma.jobArea.findUnique({
    where: { id },
    include: { _count: { select: { laborEntries: true } } },
  });
  if (!area) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(area.jobId, "write");
  if ("response" in ctx) return ctx.response;

  if (area._count.laborEntries > 0) {
    const updated = await prisma.jobArea.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ ...updated, deactivated: true });
  }

  await prisma.jobArea.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

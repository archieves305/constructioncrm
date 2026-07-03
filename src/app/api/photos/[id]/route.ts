import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FieldPhotoCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { deleteFile } from "@/lib/files/storage";
import { fromDbDate } from "@/lib/labor/dates";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  category: z.enum(Object.keys(FieldPhotoCategory) as [string, ...string[]]).optional(),
  caption: z.string().trim().max(500).optional().nullable(),
  areaText: z.string().trim().max(160).optional().nullable(),
  jobAreaId: z.string().trim().max(40).optional().nullable(),
  dailyLaborEntryId: z.string().trim().max(40).optional().nullable(),
});

export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  const photo = await prisma.fieldPhoto.findUnique({
    where: { id },
    include: {
      takenBy: { select: { id: true, firstName: true, lastName: true } },
      jobArea: { select: { id: true, name: true } },
      dailyLog: { select: { id: true, logDate: true, status: true } },
    },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(photo.jobId, "read");
  if ("response" in ctx) return ctx.response;

  return NextResponse.json({ ...photo, photoDate: fromDbDate(photo.photoDate) });
}

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const photo = await prisma.fieldPhoto.findUnique({
    where: { id },
    include: { dailyLog: { select: { status: true } } },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(photo.jobId, "write");
  if ("response" in ctx) return ctx.response;
  if (photo.dailyLog?.status === "APPROVED" && ctx.session.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Log is approved — photos are locked" },
      { status: 409 },
    );
  }

  const v = await validateBody(request, patchSchema);
  if (!v.ok) return v.response;

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v.data)) {
    if (value !== undefined) data[key] = value;
  }
  const updated = await prisma.fieldPhoto.update({ where: { id }, data });
  return NextResponse.json({ ...updated, photoDate: fromDbDate(updated.photoDate) });
}

export async function DELETE(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  const photo = await prisma.fieldPhoto.findUnique({
    where: { id },
    include: { dailyLog: { select: { status: true } } },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(photo.jobId, "write");
  if ("response" in ctx) return ctx.response;

  const isAdmin = ctx.session.user.role === "ADMIN";
  // Field users may delete their own photos while the log is unlocked;
  // anything on an approved log (or someone else's photo) needs ADMIN.
  if (photo.dailyLog?.status === "APPROVED" && !isAdmin) {
    return NextResponse.json(
      { error: "Log is approved — photos are locked" },
      { status: 409 },
    );
  }
  if (photo.takenByUserId !== ctx.session.user.id && !isAdmin &&
      ctx.session.user.role !== "MANAGER") {
    return forbidden();
  }

  await prisma.fieldPhoto.delete({ where: { id } });
  await deleteFile(photo.storageKey);

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "FieldPhoto",
    entityId: id,
    action: "delete",
    before: { jobId: photo.jobId, fileName: photo.fileName, category: photo.category },
  });

  return NextResponse.json({ ok: true });
}

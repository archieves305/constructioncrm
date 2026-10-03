import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { fromDbDate, isIsoDate, toDbDate } from "@/lib/labor/dates";
import { fileReadWhere } from "@/lib/files/access";
import { fileExists } from "@/lib/files/storage";
import { mergeGallery } from "@/lib/photos/gallery";
import { dayKey, endOfDayIn, startOfDayIn } from "@/lib/time/zone";

type Context = { params: Promise<{ id: string }> };

/** Enough for a job's whole record on one screen; the filters narrow it past that. */
const TAKE = 300;

/**
 * A job's photos from both stores: daily-log photos and image files on the
 * job (taken from a task, or uploaded on the Files tab). Nothing is copied;
 * each item says where it came from and whether its image is still in the
 * store.
 */
export async function GET(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const fromOk = from && isIsoDate(from) ? from : null;
  const toOk = to && isIsoDate(to) ? to : null;

  const [logPhotos, files] = await Promise.all([
    prisma.fieldPhoto.findMany({
      where: { jobId, ...(fromOk || toOk ? { photoDate: { ...(fromOk ? { gte: toDbDate(fromOk) } : {}), ...(toOk ? { lte: toDbDate(toOk) } : {}) } } : {}) },
      orderBy: [{ photoDate: "desc" }, { createdAt: "desc" }],
      take: TAKE,
      select: {
        id: true, photoDate: true, createdAt: true, category: true, caption: true, areaText: true, fileName: true, dailyLogId: true, storageKey: true,
        jobArea: { select: { name: true } },
        takenBy: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.file.findMany({
      where: {
        AND: [
          // A photographed receipt belongs with its expense, not in the job's photos.
          { jobId, fileType: { startsWith: "image/" }, category: { not: "RECEIPT" } },
          fromOk || toOk ? { createdAt: { ...(fromOk ? { gte: startOfDayIn(fromOk) } : {}), ...(toOk ? { lte: endOfDayIn(toOk) } : {}) } } : {},
          fileReadWhere(ctx.session.user),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: {
        id: true, fileName: true, createdAt: true, taskId: true, storageKey: true,
        task: { select: { id: true, title: true } },
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const [logThere, fileThere] = await Promise.all([
    Promise.all(logPhotos.map((p) => fileExists(p.storageKey))),
    Promise.all(files.map((f) => fileExists(f.storageKey))),
  ]);

  const items = mergeGallery(
    jobId,
    logPhotos.map(({ storageKey: _k, ...p }, i) => (void _k, { ...p, photoDate: fromDbDate(p.photoDate), missing: !logThere[i] })),
    files.map(({ storageKey: _k, ...f }, i) => (void _k, { ...f, day: dayKey(f.createdAt), missing: !fileThere[i] })),
  );
  return NextResponse.json({ items, canWrite: ctx.access === "write" });
}

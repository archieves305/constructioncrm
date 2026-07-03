import { NextRequest, NextResponse } from "next/server";
import { FieldPhotoCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { badRequest } from "@/lib/auth/helpers";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { isIsoDate, toDbDate, fromDbDate } from "@/lib/labor/dates";
import { MAX_UPLOAD_BYTES, saveFile } from "@/lib/files/storage";

type Context = { params: Promise<{ id: string }> };

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const MAX_FILES_PER_REQUEST = 10;
const CLIENT_ID_RE = /^[a-z][a-z0-9]{19,31}$/;

function serializePhoto(p: {
  photoDate: Date;
  [key: string]: unknown;
}) {
  return { ...p, photoDate: fromDbDate(p.photoDate) };
}

export async function GET(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const category = searchParams.get("category");
  const jobAreaId = searchParams.get("jobAreaId");
  const dailyLogId = searchParams.get("dailyLogId");
  const cursor = searchParams.get("cursor");
  const take = Math.min(Number(searchParams.get("take")) || 60, 120);

  const where: Record<string, unknown> = { jobId };
  if (category && category in FieldPhotoCategory) where.category = category;
  if (jobAreaId) where.jobAreaId = jobAreaId;
  if (dailyLogId) where.dailyLogId = dailyLogId;
  const dateFilter: Record<string, Date> = {};
  if (from && isIsoDate(from)) dateFilter.gte = toDbDate(from);
  if (to && isIsoDate(to)) dateFilter.lte = toDbDate(to);
  if (Object.keys(dateFilter).length) where.photoDate = dateFilter;

  const photos = await prisma.fieldPhoto.findMany({
    where,
    select: {
      id: true,
      photoDate: true,
      category: true,
      caption: true,
      areaText: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      dailyLogId: true,
      jobAreaId: true,
      createdAt: true,
      takenBy: { select: { id: true, firstName: true, lastName: true } },
      jobArea: { select: { id: true, name: true } },
    },
    orderBy: [{ photoDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = photos.length > take;
  const page = hasMore ? photos.slice(0, take) : photos;
  return NextResponse.json({
    photos: page.map(serializePhoto),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

// Multipart multi-file upload. Shared fields apply to every file in the
// request; per-file client ids (id_0, id_1, …) make offline retries
// skip-if-exists instead of duplicating.
export async function POST(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return badRequest("file is required");
  if (files.length > MAX_FILES_PER_REQUEST) {
    return badRequest(`At most ${MAX_FILES_PER_REQUEST} photos per request`);
  }

  const photoDateRaw = String(form.get("photoDate") ?? "");
  const photoDate = isIsoDate(photoDateRaw)
    ? photoDateRaw
    : new Date().toISOString().slice(0, 10);
  const categoryRaw = String(form.get("category") ?? "PROGRESS");
  const category =
    categoryRaw in FieldPhotoCategory
      ? (categoryRaw as FieldPhotoCategory)
      : "PROGRESS";
  const caption = String(form.get("caption") ?? "").trim() || null;
  const areaText = String(form.get("areaText") ?? "").trim() || null;
  const jobAreaId = String(form.get("jobAreaId") ?? "").trim() || null;
  const dailyLogId = String(form.get("dailyLogId") ?? "").trim() || null;
  const dailyLaborEntryId =
    String(form.get("dailyLaborEntryId") ?? "").trim() || null;

  if (dailyLogId) {
    const log = await prisma.dailyLog.findUnique({
      where: { id: dailyLogId },
      select: { jobId: true, status: true },
    });
    if (!log || log.jobId !== jobId) return badRequest("Invalid dailyLogId");
    // Photos may still be added to SUBMITTED logs (forgot-one case); only
    // APPROVED is frozen.
    if (log.status === "APPROVED") {
      return NextResponse.json(
        { error: "Log is approved — photos are locked" },
        { status: 409 },
      );
    }
  }

  const created = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size === 0) return badRequest(`${file.name} is empty`);
    if (file.size > MAX_UPLOAD_BYTES) {
      return badRequest(`${file.name} exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
    }
    if (!IMAGE_MIME.has(file.type)) {
      return badRequest(`unsupported image type: ${file.type || "unknown"}`);
    }

    const clientIdRaw = String(form.get(`id_${i}`) ?? "");
    const clientId = CLIENT_ID_RE.test(clientIdRaw) ? clientIdRaw : null;
    if (clientId) {
      const existing = await prisma.fieldPhoto.findUnique({
        where: { id: clientId },
        select: { id: true },
      });
      if (existing) {
        created.push({ id: existing.id, duplicate: true });
        continue;
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await saveFile(buffer, file.name);
    const photo = await prisma.fieldPhoto.create({
      data: {
        ...(clientId ? { id: clientId } : {}),
        jobId,
        dailyLogId,
        dailyLaborEntryId,
        jobAreaId,
        photoDate: toDbDate(photoDate),
        category,
        caption,
        areaText,
        fileName: file.name,
        fileType: file.type,
        fileSize: stored.bytes,
        storageKey: stored.storageKey,
        takenByUserId: ctx.session.user.id,
      },
      select: { id: true, photoDate: true, category: true, fileName: true },
    });
    created.push(serializePhoto(photo));
  }

  return NextResponse.json({ photos: created }, { status: 201 });
}

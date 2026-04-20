import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { FileCategory } from "@/generated/prisma/client";
import { saveFile, MAX_UPLOAD_BYTES, ALLOWED_MIME } from "@/lib/files/storage";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const leadId = request.nextUrl.searchParams.get("leadId");
  if (!leadId) return badRequest("leadId is required");

  const files = await prisma.file.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    include: {
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(files);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const form = await request.formData();
  const file = form.get("file");
  const leadId = form.get("leadId");
  const categoryRaw = form.get("category");

  if (!(file instanceof File)) return badRequest("file is required");
  if (typeof leadId !== "string" || !leadId) return badRequest("leadId is required");

  if (file.size === 0) return badRequest("file is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    return badRequest(`file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return badRequest(`unsupported file type: ${file.type || "unknown"}`);
  }

  const category =
    typeof categoryRaw === "string" && categoryRaw in FileCategory
      ? (categoryRaw as FileCategory)
      : FileCategory.OTHER;

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) return badRequest("lead not found");

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await saveFile(buffer, file.name);

  const record = await prisma.file.create({
    data: {
      leadId,
      fileName: file.name,
      fileType: file.type,
      fileSize: stored.bytes,
      storageKey: stored.storageKey,
      category,
      uploadedByUserId: session.user.id,
    },
    include: {
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(record, { status: 201 });
}

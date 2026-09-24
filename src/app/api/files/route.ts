import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest, forbidden } from "@/lib/auth/helpers";
import { canEditTask } from "@/lib/tasks/access";
import { recordTaskEvent } from "@/lib/tasks/events";
import { FileCategory } from "@/generated/prisma/client";
import { saveFile, MAX_UPLOAD_BYTES, ALLOWED_MIME } from "@/lib/files/storage";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const leadId = request.nextUrl.searchParams.get("leadId");
  const taskId = request.nextUrl.searchParams.get("taskId");
  if (!leadId && !taskId) return badRequest("leadId or taskId is required");

  const files = await prisma.file.findMany({
    where: taskId ? { taskId } : { leadId: leadId! },
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
  const leadIdRaw = form.get("leadId");
  const taskIdRaw = form.get("taskId");
  const categoryRaw = form.get("category");

  if (!(file instanceof File)) return badRequest("file is required");

  // Evidence for a workflow step: the file hangs off the task AND the task's
  // lead, so the lead's Files tab still lists it. Anyone who may edit the
  // task may attach to it.
  const taskId = typeof taskIdRaw === "string" && taskIdRaw ? taskIdRaw : null;
  let leadId = typeof leadIdRaw === "string" && leadIdRaw ? leadIdRaw : null;
  if (taskId) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, leadId: true, assignedUserId: true, createdByUserId: true },
    });
    if (!task) return badRequest("task not found");
    if (!canEditTask(session.user, task)) return forbidden();
    if (!task.leadId) return badRequest("this task is not linked to a lead, so a file cannot be stored against it");
    leadId = task.leadId;
  }
  if (!leadId) return badRequest("leadId is required");

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
      taskId,
    },
    include: {
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (taskId) {
    await recordTaskEvent({ taskId, actorUserId: session.user.id, type: "EVIDENCE_ATTACHED", toValue: record.id, body: record.fileName });
  }

  return NextResponse.json(record, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest, forbidden } from "@/lib/auth/helpers";
import { recordTaskEvent } from "@/lib/tasks/events";
import { FileCategory } from "@/generated/prisma/client";
import { saveFile, MAX_UPLOAD_BYTES, ALLOWED_MIME } from "@/lib/files/storage";
import { taskRightsFor } from "@/lib/workflows/visibility";
import { fileReadWhere } from "@/lib/files/access";
import { FILE_LIST_INCLUDE, presentFiles } from "@/lib/files/list";
import { guardJob } from "@/lib/access/records";
import { canEnterJobCosts, getCostGrants, COST_DENIED_MESSAGE } from "@/lib/expenses/permissions";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const leadId = request.nextUrl.searchParams.get("leadId");
  const taskId = request.nextUrl.searchParams.get("taskId");
  const violationCaseId = request.nextUrl.searchParams.get("violationCaseId");
  const violationItemId = request.nextUrl.searchParams.get("violationItemId");
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!leadId && !taskId && !violationCaseId && !violationItemId && !jobId) return badRequest("jobId, leadId, taskId, violationCaseId or violationItemId is required");
  const scope = fileReadWhere(session.user);

  // A job: its own files, and beside them the lead's documents that belong to
  // no job (estimates, things uploaded before the job existed).
  if (jobId) {
    const denied = await guardJob(session.user, jobId, "read");
    if (denied) return denied;
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { leadId: true } });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [files, leadFiles] = await Promise.all([
      prisma.file.findMany({ where: { AND: [{ jobId }, scope] }, orderBy: { createdAt: "desc" }, include: FILE_LIST_INCLUDE }),
      prisma.file.findMany({ where: { AND: [{ leadId: job.leadId, jobId: null, violationCaseId: null }, scope] }, orderBy: { createdAt: "desc" }, include: FILE_LIST_INCLUDE }),
    ]);
    return NextResponse.json({ files: await presentFiles(files), leadFiles: await presentFiles(leadFiles) });
  }

  const files = await prisma.file.findMany({
    where: {
      AND: [
        taskId ? { taskId } : violationItemId ? { violationItemId } : violationCaseId ? { violationCaseId } : { leadId: leadId! },
        scope,
      ],
    },
    orderBy: { createdAt: "desc" },
    include: FILE_LIST_INCLUDE,
  });
  return NextResponse.json(await presentFiles(files));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (session.user.role === "READ_ONLY") return forbidden();

  const form = await request.formData();
  const file = form.get("file");
  const leadIdRaw = form.get("leadId");
  const taskIdRaw = form.get("taskId");
  const categoryRaw = form.get("category");

  if (!(file instanceof File)) return badRequest("file is required");

  // A file on a task: it hangs off the task AND, when the task has one, the
  // task's lead, so the lead's Files tab still lists it. A task raised with no
  // job has no lead and the file lives on the task alone. Anyone who may edit
  // the task may attach to it.
  const taskId = typeof taskIdRaw === "string" && taskIdRaw ? taskIdRaw : null;
  let leadId = typeof leadIdRaw === "string" && leadIdRaw ? leadIdRaw : null;
  // A file uploaded on a job belongs to that job (and, through it, the lead).
  const jobIdRaw = form.get("jobId");
  let jobId = typeof jobIdRaw === "string" && jobIdRaw ? jobIdRaw : null;
  if (jobId) {
    const denied = await guardJob(session.user, jobId, "read");
    if (denied) return denied;
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { leadId: true } });
    if (!job) return badRequest("job not found");
    leadId = job.leadId;
  }
  // A document or photo on a code-violation case (or one of its items): the
  // file hangs off the case AND the case's lead. Anyone who may edit the case may attach.
  const caseIdRaw = form.get("violationCaseId");
  const itemIdRaw = form.get("violationItemId");
  let violationCaseId = typeof caseIdRaw === "string" && caseIdRaw ? caseIdRaw : null;
  const violationItemId = typeof itemIdRaw === "string" && itemIdRaw ? itemIdRaw : null;
  if (violationItemId) {
    const item = await prisma.codeViolationItem.findUnique({ where: { id: violationItemId }, select: { caseId: true } });
    if (!item) return badRequest("violation item not found");
    violationCaseId = item.caseId;
  }
  if (violationCaseId) {
    const { caseScopeFor } = await import("@/lib/violations/scope");
    const { canEditCase } = await import("@/lib/violations/access");
    const c = await prisma.codeViolationCase.findUnique({ where: { id: violationCaseId }, select: { leadId: true } });
    const scope = await caseScopeFor(violationCaseId);
    if (!c || !scope) return badRequest("violation case not found");
    if (!canEditCase(session.user, scope)) return forbidden();
    leadId = c.leadId;
  }
  if (taskId) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, leadId: true, assignedUserId: true, createdByUserId: true, jobId: true, violationCaseId: true, workflowInstanceId: true },
    });
    if (!task) return badRequest("task not found");
    if (!(await taskRightsFor(session.user, task)).canEdit) return forbidden();
    leadId = task.leadId;
    // The task's job is the file's job, so it shows on that job and no other.
    jobId = task.jobId;
  }
  // A receipt on a job expense: the file takes the expense's job and lead.
  // Attaching one never edits the expense, so it works on bank-fed rows too;
  // it takes the right to enter job costs.
  const expenseIdRaw = form.get("expenseId");
  const expenseId = typeof expenseIdRaw === "string" && expenseIdRaw ? expenseIdRaw : null;
  if (expenseId) {
    const grants = await getCostGrants(session.user.id);
    if (!canEnterJobCosts(session.user.role, grants)) return NextResponse.json({ error: COST_DENIED_MESSAGE }, { status: 403 });
    const expense = await prisma.jobExpense.findUnique({ where: { id: expenseId }, select: { jobId: true, job: { select: { leadId: true } } } });
    if (!expense) return badRequest("expense not found");
    jobId = expense.jobId;
    leadId = expense.job.leadId;
  }
  if (!leadId && !taskId) return badRequest("leadId is required");

  if (file.size === 0) return badRequest("file is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    return badRequest(`file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return badRequest(`unsupported file type: ${file.type || "unknown"}`);
  }

  const category = expenseId
    ? FileCategory.RECEIPT
    : typeof categoryRaw === "string" && categoryRaw in FileCategory
      ? (categoryRaw as FileCategory)
      : FileCategory.OTHER;

  if (leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
    if (!lead) return badRequest("lead not found");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await saveFile(buffer, file.name);

  const record = await prisma.file.create({
    data: {
      leadId,
      // A case's files hang off the case; a case links to its jobs itself.
      jobId: violationCaseId ? null : jobId,
      fileName: file.name,
      fileType: file.type,
      fileSize: stored.bytes,
      storageKey: stored.storageKey,
      category,
      uploadedByUserId: session.user.id,
      taskId,
      violationCaseId,
      violationItemId,
      expenseId,
    },
    include: FILE_LIST_INCLUDE,
  });
  if (taskId) {
    await recordTaskEvent({ taskId, actorUserId: session.user.id, type: "EVIDENCE_ATTACHED", toValue: record.id, body: record.fileName });
  }
  if (violationCaseId) {
    const { recordCaseEvent } = await import("@/lib/violations/events");
    await recordCaseEvent(prisma, { caseId: violationCaseId, itemId: violationItemId, actorUserId: session.user.id, type: "FILE_ATTACHED", toValue: record.id, body: `${record.category.toLowerCase()} · ${record.fileName}` });
  }

  return NextResponse.json((await presentFiles([record]))[0], { status: 201 });
}

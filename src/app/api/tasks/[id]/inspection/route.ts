import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { inspectionResultSchema } from "@/lib/validators/workflow";
import { canRecordInspection } from "@/lib/workflows/access";
import { jobScopeFor } from "@/lib/workflows/visibility";
import { recordInspectionResult, InspectionError } from "@/lib/workflows/inspections";
import { TASK_DETAIL_INCLUDE } from "@/lib/tasks/include";
import { parseDueAt } from "@/lib/tasks/dates";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, inspectionResultSchema);
  if (!parsed.ok) return parsed.response;
  const task = await prisma.task.findUnique({ where: { id }, select: { id: true, jobId: true, assignedUserId: true } });
  if (!task || !task.jobId) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const jobScope = await jobScopeFor(task.jobId);
  if (!jobScope || !canRecordInspection(session.user, jobScope, task)) return forbidden();
  try {
    const result = await recordInspectionResult({
      taskId: id,
      result: parsed.data.result,
      notes: parsed.data.notes ?? null,
      inspectedAt: parsed.data.inspectedAt ? parseDueAt(parsed.data.inspectedAt) : null,
      jobPermitInspectionId: parsed.data.jobPermitInspectionId ?? null,
      actor: session.user,
    });
    const detail = await prisma.task.findUnique({ where: { id }, include: TASK_DETAIL_INCLUDE });
    return NextResponse.json({ ...result, task: detail });
  } catch (err) {
    if (err instanceof InspectionError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

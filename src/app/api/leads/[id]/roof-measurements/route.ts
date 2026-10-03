import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { guardLead } from "@/lib/access/records";
import { validateBody } from "@/lib/validation/body";
import { MAX_UPLOAD_BYTES } from "@/lib/files/limits";
import { createFromReport, createManual, listMeasurements } from "@/lib/roofing/service";
import { createManualSchema } from "@/lib/roofing/validation";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardLead(session.user, id, "read");
  if (denied) return denied;
  return NextResponse.json(await listMeasurements(id));
}

/** A job named on the request must be one of this lead's. */
async function jobOnLead(leadId: string, jobId: string | null | undefined): Promise<{ jobId: string | null } | NextResponse> {
  if (!jobId) return { jobId: null };
  const job = await prisma.job.findFirst({ where: { id: jobId, leadId }, select: { id: true } });
  return job ? { jobId: job.id } : badRequest("That job does not belong to this lead");
}

/**
 * Add a measurement: a Roofr report (multipart, field `file`, PDF) that is
 * read into numbers, or numbers typed by a person (JSON).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardLead(session.user, id, "write");
  if (denied) return denied;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("file is required");
    if (file.size === 0) return badRequest("file is empty");
    if (file.size > MAX_UPLOAD_BYTES) return badRequest(`file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
    if (file.type !== "application/pdf") return badRequest("A measurement report must be a PDF");
    const jobIdRaw = form.get("jobId");
    const job = await jobOnLead(id, typeof jobIdRaw === "string" && jobIdRaw ? jobIdRaw : null);
    if (job instanceof NextResponse) return job;
    const created = await createFromReport({ leadId: id, jobId: job.jobId, buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, fileType: file.type, userId: session.user.id });
    return NextResponse.json(created, { status: 201 });
  }

  const body = await validateBody(request, createManualSchema);
  if (!body.ok) return body.response;
  const job = await jobOnLead(id, body.data.jobId);
  if (job instanceof NextResponse) return job;
  const created = await createManual({ leadId: id, jobId: job.jobId, label: body.data.label || null, source: body.data.source, values: body.data.values, userId: session.user.id });
  return NextResponse.json(created, { status: 201 });
}

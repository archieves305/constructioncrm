import { NextRequest, NextResponse } from "next/server";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { MAX_PLAN_UPLOAD_BYTES } from "@/lib/takeoff/limits";
import { guardPlanSet } from "@/lib/takeoff/route-guards";
import { addDocument } from "@/lib/takeoff/service";
import { documentFieldsSchema } from "@/lib/takeoff/validation";

/**
 * Add a PDF to a plan set. Multipart: `file` (PDF, up to 95 MB — this route
 * has its own ceiling, the generic file route keeps 25 MB), `kind`, `label`,
 * `revisionLabel`. Answers as soon as the file is stored; the index job it
 * returns is driven by ticks.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardPlanSet(session.user, id, "write");
  if (denied) return denied;
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) return badRequest("Expected a multipart upload");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("file is required");
  if (file.size === 0) return badRequest("file is empty");
  if (file.size > MAX_PLAN_UPLOAD_BYTES) return badRequest(`file exceeds the ${MAX_PLAN_UPLOAD_BYTES / 1024 / 1024} MB limit — split the set and upload it in parts`);
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return badRequest("A plan set must be a PDF");
  const fields = documentFieldsSchema.safeParse({
    kind: form.get("kind") || undefined,
    label: form.get("label") || file.name.replace(/\.pdf$/i, "").slice(0, 120),
    revisionLabel: form.get("revisionLabel") || null,
  });
  if (!fields.success) return badRequest("kind, label or revisionLabel is not valid");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") return badRequest("That file is not a PDF");
  const result = await addDocument({ planSetId: id, buffer, fileName: file.name, kind: fields.data.kind, label: fields.data.label, revisionLabel: fields.data.revisionLabel ?? null, userId: session.user.id });
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json({ error: "Plan set not found" }, { status: 404 });
    return NextResponse.json({ error: `This PDF is already in the set as "${result.label}"` }, { status: 409 });
  }
  return NextResponse.json(result, { status: 201 });
}

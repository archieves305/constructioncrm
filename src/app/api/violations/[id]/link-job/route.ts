import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { linkJobSchema } from "@/lib/validators/violation";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";
import { linkJob, unlinkJob } from "@/lib/violations/update";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, linkJobSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canEdit);
  if ("response" in gate) return gate.response;
  try {
    await linkJob(id, parsed.data.jobId, session.user);
    return NextResponse.json(await readCase(id, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const gate = await requireCase(id, session.user, (p) => p.canEdit);
  if ("response" in gate) return gate.response;
  try {
    await unlinkJob(id, session.user);
    return NextResponse.json(await readCase(id, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}

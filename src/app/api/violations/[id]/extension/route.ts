import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { extensionCreateSchema } from "@/lib/validators/violation";
import { requestExtension } from "@/lib/violations/deadline";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, extensionCreateSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canChangeDeadline);
  if ("response" in gate) return gate.response;
  try {
    await requestExtension(id, parsed.data, session.user);
    return NextResponse.json(await readCase(id, session.user), { status: 201 });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}

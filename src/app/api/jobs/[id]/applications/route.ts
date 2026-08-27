import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import {
  canManageProgressBilling,
  createApplication,
} from "@/lib/services/progress-billing";

const lineSchema = z.object({
  sovLineId: z.string().min(1),
  workCompleted: z.number().min(0),
});

const createSchema = z.object({
  periodFrom: z.string().nullable().optional(),
  periodTo: z.string().min(10),
  lines: z.array(lineSchema).min(1),
  dueDate: z.string().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: z.enum(["DRAFT", "SENT"]).optional(),
});

/** Issue a payment application (progress invoice) for work completed this period. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageProgressBilling(session.user.role)) return forbidden();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const result = await createApplication(id, parsed.data, session.user.id);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 400;
    return NextResponse.json({ error: result.message, reason: result.reason }, { status });
  }
  return NextResponse.json(result, { status: 201 });
}

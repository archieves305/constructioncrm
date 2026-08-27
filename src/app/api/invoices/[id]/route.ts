import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import {
  canManageProgressBilling,
  canVoidApplication,
  updateApplication,
} from "@/lib/services/progress-billing";

const updateSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "PAID", "VOID"]).optional(),
  amount: z.number().min(0).optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  // Payment applications only: the period and this period's work per SOV
  // line. `amount` is derived from these and can't be set directly.
  periodFrom: z.string().nullable().optional(),
  periodTo: z.string().min(10).optional(),
  lines: z
    .array(z.object({ sovLineId: z.string().min(1), workCompleted: z.number().min(0) }))
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { applicationNumber: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isApplication = existing.applicationNumber != null;
  if (isApplication) {
    if (!canManageProgressBilling(session.user.role)) return forbidden();
    if (parsed.data.amount !== undefined)
      return badRequest("An application's amount is derived from its lines");
    if (parsed.data.status === "VOID" && !(await canVoidApplication(id)))
      return badRequest(
        "A later application builds on this one; void the later ones first",
      );
    const { periodFrom, periodTo, lines } = parsed.data;
    if (periodFrom !== undefined || periodTo !== undefined || lines !== undefined) {
      const result = await updateApplication(id, { periodFrom, periodTo, lines });
      if (!result.ok)
        return NextResponse.json(
          { error: result.message, reason: result.reason },
          { status: result.reason === "not_found" ? 404 : 400 },
        );
    }
  } else if (parsed.data.lines !== undefined || parsed.data.periodTo !== undefined) {
    return badRequest("Only a payment application has a period and lines");
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.amount !== undefined) data.amount = parsed.data.amount;
  if (parsed.data.dueDate !== undefined)
    data.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

  const record = await prisma.invoice
    .update({ where: { id }, data })
    .catch(() => null);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}

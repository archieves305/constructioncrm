import { NextRequest, NextResponse, after } from "next/server";
import { onInvoiceTransition } from "@/lib/tasks/auto-tasks";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import {
  canManageProgressBilling,
  canVoidApplication,
  updateApplication,
} from "@/lib/services/progress-billing";

const updateSchema = z.object({
  retainagePercent: z.number().min(0).max(100).optional(),
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
    select: { applicationNumber: true, status: true },
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
    const { periodFrom, periodTo, lines, retainagePercent } = parsed.data;
    if (periodFrom !== undefined || periodTo !== undefined || lines !== undefined || retainagePercent !== undefined) {
      const result = await updateApplication(id, { periodFrom, periodTo, lines, retainagePercent });
      if (!result.ok)
        return NextResponse.json(
          { error: result.message, reason: result.reason },
          { status: result.reason === "not_found" ? 404 : 400 },
        );
    }
  } else if (parsed.data.lines !== undefined || parsed.data.periodTo !== undefined || parsed.data.retainagePercent !== undefined) {
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

  // A manual status change raises or retires the collect-payment task.
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    const from = existing.status;
    const to = parsed.data.status;
    const actorUserId = session.user.id;
    after(async () => {
      await onInvoiceTransition(id, { from, to }, actorUserId);
    });
  }
  return NextResponse.json(record);
}

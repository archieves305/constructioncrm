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
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { recordAudit } from "@/lib/audit/record";

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
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { applicationNumber: true, status: true, amount: true, dueDate: true, notes: true, _count: { select: { payments: true } } },
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
  } else if (parsed.data.amount !== undefined && Number(parsed.data.amount) !== Number(existing.amount) && (existing.status === "SENT" || existing.status === "PAID")) {
    // What the customer was sent is a record: a different amount is a new invoice.
    return badRequest("A sent invoice's amount is fixed. Void it and issue a new one.");
  } else if (parsed.data.lines !== undefined || parsed.data.periodTo !== undefined || parsed.data.retainagePercent !== undefined) {
    return badRequest("Only a payment application has a period and lines");
  }

  if (parsed.data.status === "VOID" && existing.status !== "VOID" && existing._count.payments > 0) {
    return badRequest("Payments are recorded against this invoice. Move or delete them before voiding it.");
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

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "invoice",
    entityId: id,
    action: "invoice_update",
    before: { status: existing.status, amount: Number(existing.amount), dueDate: existing.dueDate, notes: existing.notes },
    after: parsed.data,
  });

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

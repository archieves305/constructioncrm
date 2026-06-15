import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";

const MS_PER_DAY = 86400000;

/**
 * Daily sweep that logs an overdue alert for each unpaid (SENT) invoice past its
 * due date. Deduped against any overdue alert logged for the same invoice in the
 * last 30 days, so re-running daily doesn't refire the same alert.
 *
 * Auth mirrors the other cron routes: requires the `x-cron-secret` header to
 * match env.CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 503 },
    );
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const dedupeSince = new Date(now.getTime() - 30 * MS_PER_DAY);

  const overdue = await prisma.invoice.findMany({
    where: { status: "SENT", dueDate: { not: null, lt: now } },
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      dueDate: true,
      job: { select: { leadId: true } },
      payments: { where: { status: "RECEIVED" }, select: { amount: true } },
    },
  });

  let alerted = 0;
  for (const inv of overdue) {
    const applied = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining = Number(inv.amount) - applied;
    if (remaining <= 0) continue;

    const marker = `Invoice ${inv.invoiceNumber} overdue`;
    const existing = await prisma.activityLog.findFirst({
      where: {
        leadId: inv.job.leadId,
        activityType: "NOTE",
        title: { startsWith: marker },
        createdAt: { gte: dedupeSince },
      },
      select: { id: true },
    });
    if (existing) continue;

    const days = inv.dueDate
      ? Math.floor((now.getTime() - inv.dueDate.getTime()) / MS_PER_DAY)
      : 0;
    await prisma.activityLog.create({
      data: {
        leadId: inv.job.leadId,
        activityType: "NOTE",
        title: `${marker} — ${days} days ($${remaining.toLocaleString()})`,
        description: "Customer invoice is past due and unpaid.",
        metadataJson: { kind: "INVOICE_OVERDUE", invoiceId: inv.id },
        createdByUserId: null,
      },
    });
    alerted++;
  }

  return NextResponse.json({ scanned: overdue.length, alerted });
}

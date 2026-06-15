import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import {
  generateChangeOrderToken,
  changeOrderTokenExpiry,
  getChangeOrderByToken,
  sendChangeOrderEmail,
} from "@/lib/services/change-orders";
import { logger } from "@/lib/logger";

// POST /api/change-orders/[id]/send — email the customer the change-order bill.
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const co = await prisma.changeOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      token: true,
      job: { select: { lead: { select: { email: true } } } },
    },
  });
  if (!co) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (co.status === "APPROVED" || co.status === "REJECTED")
    return badRequest("This change order has already been decided");
  if (!co.job.lead.email)
    return badRequest("Customer has no email address on file");

  const token = co.token ?? generateChangeOrderToken();
  await prisma.changeOrder.update({
    where: { id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      token,
      tokenExpiresAt: changeOrderTokenExpiry(),
    },
  });

  const full = await getChangeOrderByToken(token);
  if (!full)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  let emailed = false;
  try {
    emailed = await sendChangeOrderEmail(full, session.user.email ?? null);
  } catch (err) {
    logger.error("change-order send failed", {
      changeOrderId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to send email. The change order is marked sent — retry or share the link." },
      { status: 502 },
    );
  }

  await prisma.activityLog.create({
    data: {
      leadId: full.job.leadId,
      activityType: "NOTE",
      title: `Change order CO-${full.number} sent to customer`,
      description: emailed
        ? `Emailed to ${full.job.lead.email}`
        : "Email not configured — share the link manually",
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json({ ok: true, emailed, token });
}

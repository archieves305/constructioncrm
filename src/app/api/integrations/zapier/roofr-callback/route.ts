import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyZapierAuth } from "@/lib/integrations/zapier/auth";
import { validateBody } from "@/lib/validation/body";
import { logger } from "@/lib/logger";

// POST /api/integrations/zapier/roofr-callback
//
// Zapier hits this when Roofr finishes (or fails) a report we ordered.
// `orderId` is the RoofrOrder cuid we sent out on the original request —
// that's the match key. Everything else is optional metadata. Idempotent:
// completing an already-COMPLETED order is a no-op.
const callbackSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["COMPLETED", "FAILED", "CANCELLED"]).default("COMPLETED"),
  externalOrderId: z.string().optional(),
  reportUrl: z.string().url().optional(),
  errorMessage: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest) {
  const authFail = verifyZapierAuth(request);
  if (authFail) return authFail;

  const validated = await validateBody(request, callbackSchema);
  if (!validated.ok) return validated.response;

  const { orderId, status, externalOrderId, reportUrl, errorMessage } =
    validated.data;

  const existing = await prisma.roofrOrder.findUnique({
    where: { id: orderId },
    select: { id: true, leadId: true, status: true },
  });
  if (!existing) {
    logger.warn("Zapier Roofr callback for unknown orderId", { orderId });
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Idempotency: a finalized order shouldn't be re-finalized. Zapier
  // sometimes retries — quietly acknowledge.
  const isFinal = (s: string) =>
    s === "COMPLETED" || s === "CANCELLED" || s === "FAILED";
  if (isFinal(existing.status)) {
    return NextResponse.json({ id: existing.id, deduped: true });
  }

  const updated = await prisma.roofrOrder.update({
    where: { id: orderId },
    data: {
      status,
      externalOrderId: externalOrderId ?? undefined,
      reportUrl: reportUrl ?? undefined,
      errorMessage: errorMessage ?? undefined,
      completedAt: status === "COMPLETED" ? new Date() : undefined,
    },
  });

  if (status === "COMPLETED") {
    await prisma.activityLog.create({
      data: {
        leadId: existing.leadId,
        activityType: "FILE_UPLOADED",
        title: "Roofr report ready",
        description: reportUrl
          ? `Roofr report completed. Report URL: ${reportUrl}`
          : "Roofr report completed.",
        createdByUserId: updated.createdByUserId,
      },
    });
  }

  return NextResponse.json({ id: updated.id, status: updated.status });
}

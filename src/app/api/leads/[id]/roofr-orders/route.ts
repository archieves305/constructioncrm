import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { validateBody } from "@/lib/validation/body";

const createSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const orders = await prisma.roofrOrder.findMany({
    where: { leadId: id },
    orderBy: { requestedAt: "desc" },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(orders);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (!env.ZAPIER_ROOFR_ORDER_URL) {
    return NextResponse.json(
      { error: "ZAPIER_ROOFR_ORDER_URL not configured on server" },
      { status: 503 },
    );
  }

  const { id } = await params;

  const validated = await validateBody(request, createSchema);
  if (!validated.ok) return validated.response;

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      email: true,
      primaryPhone: true,
      secondaryPhone: true,
      propertyAddress1: true,
      propertyAddress2: true,
      city: true,
      state: true,
      zipCode: true,
    },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Create the row first so we have a stable orderId to round-trip
  // through Zapier. If the outbound POST fails we mark the row FAILED
  // rather than rolling back — the user can see the attempt and retry.
  const order = await prisma.roofrOrder.create({
    data: {
      leadId: lead.id,
      status: "REQUESTED",
      notes: validated.data.notes,
      createdByUserId: session.user.id,
    },
  });

  const callbackUrl = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/integrations/zapier/roofr-callback`;
  const payload = {
    orderId: order.id,
    leadId: lead.id,
    callbackUrl,
    callbackSecretHeader: "x-zapier-secret",
    lead: {
      fullName: lead.fullName,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      primaryPhone: lead.primaryPhone,
      secondaryPhone: lead.secondaryPhone,
      propertyAddress1: lead.propertyAddress1,
      propertyAddress2: lead.propertyAddress2,
      city: lead.city,
      state: lead.state,
      zipCode: lead.zipCode,
    },
  };

  try {
    const res = await fetch(env.ZAPIER_ROOFR_ORDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const errMsg = `Zapier returned ${res.status}: ${text.slice(0, 500)}`;
      const failed = await prisma.roofrOrder.update({
        where: { id: order.id },
        data: { status: "FAILED", errorMessage: errMsg },
      });
      logger.warn("Zapier Roofr outbound failed", {
        orderId: order.id,
        leadId: lead.id,
        status: res.status,
      });
      return NextResponse.json(failed, { status: 502 });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const failed = await prisma.roofrOrder.update({
      where: { id: order.id },
      data: { status: "FAILED", errorMessage: errMsg },
    });
    logger.exception(err, { orderId: order.id, leadId: lead.id, step: "zapier_outbound" });
    return NextResponse.json(failed, { status: 502 });
  }

  await prisma.activityLog.create({
    data: {
      leadId: lead.id,
      activityType: "NOTE",
      title: "Roofr report ordered",
      description: validated.data.notes
        ? `Roofr report ordered via Zapier. Notes: ${validated.data.notes}`
        : "Roofr report ordered via Zapier.",
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(order, { status: 201 });
}

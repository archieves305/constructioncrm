import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { promoteProspectSchema } from "@/lib/validators/prospect";
import { emitLeadEvent } from "@/lib/follow-ups/events";

// Promote a prospect into a CRM lead: create the lead (address carried over
// from the prospect, contact details supplied in the body), link it back, and
// mark the prospect PROMOTED. Idempotent-ish: a prospect already linked to a
// lead returns that lead.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();
  const parsed = promoteProspectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }
  const input = parsed.data;

  const prospect = await prisma.prospect.findUnique({ where: { id } });
  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }
  if (prospect.leadId) {
    return NextResponse.json(
      { error: "Prospect already promoted", leadId: prospect.leadId },
      { status: 409 },
    );
  }

  const defaultStage = await prisma.leadStage.findFirst({
    where: { name: "New Lead" },
  });
  if (!defaultStage) return badRequest("Default stage not configured");

  const { serviceCategoryIds, ...contact } = input;

  const lead = await prisma.lead.create({
    data: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: `${contact.firstName} ${contact.lastName}`,
      primaryPhone: contact.primaryPhone,
      secondaryPhone: contact.secondaryPhone,
      email: contact.email || null,
      companyName: contact.companyName,
      propertyType: contact.propertyType,
      // Address carries over from the prospect.
      propertyAddress1: prospect.propertyAddress1,
      propertyAddress2: prospect.propertyAddress2,
      city: prospect.city,
      state: prospect.state,
      zipCode: prospect.zipCode ?? "",
      county: prospect.county,
      sourceId: contact.sourceId,
      assignedUserId: contact.assignedUserId ?? prospect.assignedToUserId ?? undefined,
      currentStageId: defaultStage.id,
      createdByUserId: session.user.id,
      nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      services: serviceCategoryIds?.length
        ? { create: serviceCategoryIds.map((sid) => ({ serviceCategoryId: sid })) }
        : undefined,
    },
    include: {
      currentStage: true,
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await prisma.prospect.update({
    where: { id },
    data: { leadId: lead.id, status: "PROMOTED", promotedAt: new Date() },
  });

  await prisma.activityLog.create({
    data: {
      leadId: lead.id,
      activityType: "LEAD_CREATED",
      title: "Lead created from canvassing prospect",
      description: `Promoted from prospect at ${prospect.propertyAddress1}`,
      createdByUserId: session.user.id,
    },
  });

  await prisma.leadStageHistory.create({
    data: {
      leadId: lead.id,
      toStageId: defaultStage.id,
      changedByUserId: session.user.id,
    },
  });

  await emitLeadEvent("LEAD_CREATED", lead.id).catch((e) =>
    console.error("emitLeadEvent LEAD_CREATED failed", e),
  );

  return NextResponse.json({ lead }, { status: 201 });
}

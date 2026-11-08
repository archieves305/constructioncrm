import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { recordAudit } from "@/lib/audit/record";
import { contactData, crewContactSchema } from "@/lib/crews/contact";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { validateBody } from "@/lib/validation/body";

const bodySchema = z.union([
  z.object({ crewId: z.string().min(1).max(60) }),
  // A crew record made from the contract's typed name, with its contact.
  z.object({ createFromLabel: z.literal(true) }).merge(crewContactSchema),
]);

/**
 * POST /api/labor-contracts/[id]/crew — link a contract typed by name to a
 * crew record (an existing one, or a new one made from the name), so the crew
 * has a contact for guest links and its work shows in one place.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const contract = await prisma.laborContract.findUnique({ where: { id }, select: { id: true, jobId: true, crewId: true, label: true } });
  if (!contract) return NextResponse.json({ error: "Labor contract not found" }, { status: 404 });
  const denied = await guardJob(session.user, contract.jobId, "write");
  if (denied) return denied;
  const v = await validateBody(request, bodySchema);
  if (!v.ok) return v.response;

  let crewId: string;
  if ("crewId" in v.data) {
    const crew = await prisma.crew.findUnique({ where: { id: v.data.crewId }, select: { id: true } });
    if (!crew) return NextResponse.json({ error: "That crew no longer exists" }, { status: 400 });
    crewId = crew.id;
  } else {
    const name = contract.label?.trim();
    if (!name) return NextResponse.json({ error: "This contract has no name to make a crew from" }, { status: 400 });
    const { createFromLabel: _c, ...contact } = v.data;
    void _c;
    crewId = (await prisma.crew.create({ data: { name, ...contactData(contact) }, select: { id: true } })).id;
  }
  // A real crew replaces the typed name (the rule the contract PATCH follows).
  const updated = await prisma.laborContract.update({
    where: { id },
    data: { crewId, label: null },
    select: { id: true, crewId: true, label: true, crew: { select: { id: true, name: true, foremanName: true, phone: true, language: true } } },
  });
  await recordAudit({ actorUserId: session.user.id, entityType: "labor_contract", entityId: id, action: "labor_contract_crew_link", before: { crewId: contract.crewId, label: contract.label }, after: { crewId } });
  return NextResponse.json(updated);
}

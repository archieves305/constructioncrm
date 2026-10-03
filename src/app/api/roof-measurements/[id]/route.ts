import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardLead } from "@/lib/access/records";
import { validateBody } from "@/lib/validation/body";
import { deleteMeasurement, updateMeasurement } from "@/lib/roofing/service";
import { updateMeasurementSchema } from "@/lib/roofing/validation";
import type { RoleName } from "@/generated/prisma/client";

const OFFICE: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

async function load(id: string) {
  return prisma.roofMeasurement.findUnique({ where: { id }, select: { id: true, leadId: true, createdByUserId: true } });
}

/** Correct values, rename, or mark the measurement reviewed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const row = await load(id);
  if (!row) return NextResponse.json({ error: "Measurement not found" }, { status: 404 });
  const denied = await guardLead(session.user, row.leadId, "write");
  if (denied) return denied;
  const body = await validateBody(request, updateMeasurementSchema);
  if (!body.ok) return body.response;
  const updated = await updateMeasurement(id, { ...body.data, userId: session.user.id });
  return NextResponse.json(updated);
}

/** Office roles, or the person who added it. The report it was read from stays in the lead's files. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const row = await load(id);
  if (!row) return NextResponse.json({ error: "Measurement not found" }, { status: 404 });
  const denied = await guardLead(session.user, row.leadId, "write");
  if (denied) return denied;
  if (!OFFICE.includes(session.user.role) && row.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: "Only the office or the person who added a measurement can remove it." }, { status: 403 });
  }
  await deleteMeasurement(id, session.user.id);
  return NextResponse.json({ ok: true });
}

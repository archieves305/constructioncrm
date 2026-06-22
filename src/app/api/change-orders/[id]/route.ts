import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  getSession,
  unauthorized,
  forbidden,
  badRequest,
  hasMinRole,
} from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { deleteChangeOrder } from "@/lib/services/change-orders";

const updateSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(8000).nullable().optional(),
  customerPrice: z.number().positive().optional(),
  crewCost: z.number().nullable().optional(),
  laborContractId: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const v = await validateBody(request, updateSchema);
  if (!v.ok) return v.response;
  const d = v.data;

  const existing = await prisma.changeOrder.findUnique({
    where: { id },
    select: { id: true, status: true, jobId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status !== "DRAFT")
    return badRequest("Only draft change orders can be edited");

  if (d.laborContractId) {
    const lc = await prisma.laborContract.findUnique({
      where: { id: d.laborContractId },
      select: { jobId: true },
    });
    if (!lc || lc.jobId !== existing.jobId)
      return badRequest("Labor contract does not belong to this job");
  }

  const data: Record<string, unknown> = {};
  if (d.title !== undefined) data.title = d.title?.trim() || null;
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.customerPrice !== undefined) data.customerPrice = d.customerPrice;
  if (d.crewCost !== undefined) data.crewCost = d.crewCost;
  if (d.laborContractId !== undefined)
    data.laborContractId = d.laborContractId || null;

  const updated = await prisma.changeOrder.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.changeOrder.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Deleting an APPROVED change order reverses billing (removes its invoice,
  // backs out the contract change) — restrict that to Admin/Manager.
  if (existing.status === "APPROVED" && !hasMinRole(session.user.role, "MANAGER"))
    return forbidden();

  if (
    existing.status !== "DRAFT" &&
    existing.status !== "APPROVED"
  )
    return badRequest("Only draft or approved change orders can be deleted");

  const result = await deleteChangeOrder(id);
  if (!result.ok) {
    if (result.reason === "not_found")
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.reason === "has_payments")
      return NextResponse.json(
        {
          error: `Invoice ${result.invoiceNumber} already has payments recorded. Remove those payments before deleting this change order.`,
        },
        { status: 409 },
      );
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContracts, canVoidSignedContract } from "@/lib/customer-contracts/access";
import { voidContract } from "@/lib/customer-contracts/service";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { voidContractSchema } from "@/lib/validators/customer-contract";

// POST /api/customer-contracts/[id]/void — the link dies; a SIGNED contract needs the stricter role.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const existing = await prisma.customerContract.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status === "SIGNED" && !canVoidSignedContract(session.user.role)) return forbidden();
  const v = await validateBody(request, voidContractSchema);
  if (!v.ok) return v.response;
  try {
    const result = await voidContract(id, session.user.id, v.data.reason);
    if (!result.ok) return NextResponse.json({ error: result.reason === "not_found" ? "Not found" : "Already void", reason: result.reason }, { status: result.reason === "not_found" ? 404 : 409 });
    return NextResponse.json(result);
  } catch (err) {
    return contractErrorResponse(err, "contracts.void");
  }
}

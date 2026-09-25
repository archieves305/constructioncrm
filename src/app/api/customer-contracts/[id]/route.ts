import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canManageContracts, canViewContracts } from "@/lib/customer-contracts/access";
import { deleteDraftContract, getContract } from "@/lib/customer-contracts/service";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";

// GET /api/customer-contracts/[id] — the full record; never the raw signing token.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const c = await getContract(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { token, ...rest } = c;
  return NextResponse.json({ ...rest, hasToken: Boolean(token) });
}

// DELETE /api/customer-contracts/[id] — a DRAFT only; anything sent is voided, not deleted.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContracts(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    await deleteDraftContract(id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return contractErrorResponse(err, "contracts.delete");
  }
}

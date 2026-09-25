import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { env } from "@/lib/env";
import { canManageContracts } from "@/lib/customer-contracts/access";

// GET /api/customer-contracts/[id]/sign-link — the customer's signing URL, for
// staff who want to text it. Only while the contract is out for signature.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const c = await prisma.customerContract.findUnique({ where: { id }, select: { status: true, token: true, tokenExpiresAt: true } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status !== "SENT" || !c.token) return NextResponse.json({ error: "This contract is not out for signature" }, { status: 409 });
  const base = (env.APP_BASE_URL || env.NEXTAUTH_URL || "").replace(/\/$/, "");
  return NextResponse.json({ signUrl: `${base}/sign/${c.token}`, expiresAt: c.tokenExpiresAt });
}

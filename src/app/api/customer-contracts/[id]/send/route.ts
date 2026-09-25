import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContracts } from "@/lib/customer-contracts/access";
import { sendContract } from "@/lib/customer-contracts/sign-service";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { sendContractSchema } from "@/lib/validators/customer-contract";

// POST /api/customer-contracts/[id]/send — issue the signing link and email the PDF.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, sendContractSchema);
  if (!v.ok) return v.response;
  try {
    const r = await sendContract(id, session.user.id, { to: v.data.to, message: v.data.message, replyTo: session.user.email });
    return NextResponse.json({ ok: true, emailed: r.emailed, signUrl: r.signUrl, sentTo: r.sentTo, expiresAt: r.expiresAt });
  } catch (err) {
    return contractErrorResponse(err, "contracts.send");
  }
}

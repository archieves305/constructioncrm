import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/body";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { declineContract } from "@/lib/customer-contracts/sign-service";
import { declineContractSchema } from "@/lib/validators/customer-contract";

const REASON_STATUS: Record<string, number> = { not_found: 404, expired: 410, already_signed: 409, already_decided: 409, not_sent: 409 };

// POST /api/sign/[token]/decline — public, token-gated.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = enforceRateLimit(request, { name: "sign-submit", limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const { token } = await params;
  const v = await validateBody(request, declineContractSchema);
  if (!v.ok) return v.response;
  const ip = clientIp(request);
  const result = await declineContract(token, v.data, { ip: ip === "unknown" ? null : ip, userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: REASON_STATUS[result.reason] ?? 409, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}

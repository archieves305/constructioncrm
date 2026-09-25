import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/body";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { getContractForSigning, signContract } from "@/lib/customer-contracts/sign-service";
import { signContractSchema } from "@/lib/validators/customer-contract";

// Public, token-gated. No session; the 256-bit token is the credential.

const VIEW_LIMIT = { name: "sign-view", limit: 60, windowMs: 60_000 };
const SUBMIT_LIMIT = { name: "sign-submit", limit: 5, windowMs: 10 * 60_000 };
const NO_STORE = { "Cache-Control": "private, no-store" };

const REASON_STATUS: Record<string, number> = { not_found: 404, expired: 410, already_signed: 409, already_decided: 409, not_sent: 409, validation: 400 };

// GET — the summary the signing page shows (the page itself loads it server-side; this backs refreshes).
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = enforceRateLimit(request, VIEW_LIMIT);
  if (limited) return limited;
  const { token } = await params;
  const view = await getContractForSigning(token);
  if (view.kind === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(view, { headers: NO_STORE });
}

// POST — sign. Records IP + user agent server-side; the customer sends only name, email, signature, consent.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = enforceRateLimit(request, SUBMIT_LIMIT);
  if (limited) return limited;
  const { token } = await params;
  const v = await validateBody(request, signContractSchema);
  if (!v.ok) return v.response;
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 1000) ?? null;
  const result = await signContract(token, { name: v.data.name, email: v.data.email, signaturePngDataUri: v.data.signaturePngDataUri, consentText: v.data.consentText }, { ip: ip === "unknown" ? null : ip, userAgent });
  if (!result.ok) return NextResponse.json({ error: result.reason, message: result.message }, { status: REASON_STATUS[result.reason] ?? 409, headers: NO_STORE });
  return NextResponse.json({ ok: true, contractNumber: result.contractNumber, signedAt: result.signedAt, signedPdfUrl: `/api/sign/${token}/pdf?kind=signed` }, { headers: NO_STORE });
}

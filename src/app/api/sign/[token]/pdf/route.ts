import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getContractByToken, readContractPdf } from "@/lib/customer-contracts/service";
import { pdfResponse } from "@/lib/customer-contracts/route-helpers";

// GET /api/sign/[token]/pdf?kind=unsigned|signed — public, token-gated, stored bytes.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = enforceRateLimit(request, { name: "sign-view", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { token } = await params;
  const c = await getContractByToken(token);
  if (!c || c.status === "VOID" || c.status === "DRAFT") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (c.tokenExpiresAt && c.tokenExpiresAt < new Date()) return NextResponse.json({ error: "expired" }, { status: 410 });
  const kind = request.nextUrl.searchParams.get("kind") === "signed" ? "signed" : "unsigned";
  if (kind === "signed" && c.status !== "SIGNED") return NextResponse.json({ error: "not_signed" }, { status: 404 });
  const pdf = await readContractPdf(c, kind);
  if (!pdf) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return pdfResponse(pdf.buffer, pdf.fileName, request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline");
}

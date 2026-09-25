import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewContracts } from "@/lib/customer-contracts/access";
import { getContract, readContractPdf } from "@/lib/customer-contracts/service";
import { contractErrorResponse, pdfResponse } from "@/lib/customer-contracts/route-helpers";

// GET /api/customer-contracts/[id]/pdf?kind=unsigned|signed — the STORED bytes,
// never a re-render: the hash on the certificate refers to exactly this file.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const kind = request.nextUrl.searchParams.get("kind") === "signed" ? "signed" : "unsigned";
  const download = request.nextUrl.searchParams.get("download") === "1";
  try {
    const c = await getContract(id);
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const pdf = await readContractPdf(c, kind);
    if (!pdf) return NextResponse.json({ error: kind === "signed" ? "No signed copy yet" : "No document" }, { status: 404 });
    return pdfResponse(pdf.buffer, pdf.fileName, download ? "attachment" : "inline");
  } catch (err) {
    return contractErrorResponse(err, "contracts.pdf");
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  getChangeOrderByToken,
  renderChangeOrderBill,
} from "@/lib/services/change-orders";

// Public, token-gated change-order bill PDF (no login).
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const co = await getChangeOrderByToken(token);
  if (!co) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (co.tokenExpiresAt && co.tokenExpiresAt < new Date())
    return NextResponse.json({ error: "Link expired" }, { status: 410 });

  const pdf = await renderChangeOrderBill(co);
  const ab = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(ab).set(pdf);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="change-order-CO-${co.number}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

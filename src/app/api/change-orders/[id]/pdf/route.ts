import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJobMoney } from "@/lib/access/records";
import {
  changeOrderPdfName,
  getChangeOrderById,
  renderChangeOrderBill,
} from "@/lib/services/change-orders";

// GET /api/change-orders/[id]/pdf — the change-order form for staff to send
// or print. `?download=1` saves it instead of opening it in the browser.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const co = await getChangeOrderById(id);
  if (!co) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = await guardJobMoney(session.user, co.jobId, "price");
  if (denied) return denied;

  const pdf = await renderChangeOrderBill(co);
  const ab = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(ab).set(pdf);
  const disposition =
    request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(ab, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${changeOrderPdfName(co)}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

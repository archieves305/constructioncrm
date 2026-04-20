import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { renderReceiptPdf } from "@/lib/pdf/receipt";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      job: {
        include: {
          lead: {
            select: {
              fullName: true,
              email: true,
              propertyAddress1: true,
              propertyAddress2: true,
              city: true,
              state: true,
              zipCode: true,
            },
          },
        },
      },
    },
  });
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (payment.status !== "RECEIVED" || !payment.receivedDate) {
    return NextResponse.json(
      { error: "Payment has not been received yet" },
      { status: 400 },
    );
  }

  const addr = [
    payment.job.lead.propertyAddress1,
    payment.job.lead.propertyAddress2,
    `${payment.job.lead.city}, ${payment.job.lead.state} ${payment.job.lead.zipCode}`,
  ]
    .filter(Boolean)
    .join(", ");

  const pdf = await renderReceiptPdf({
    receiptNumber: `R-${payment.id.slice(-8).toUpperCase()}`,
    paidDate: payment.receivedDate,
    amount: Number(payment.amount),
    paymentType: payment.paymentType,
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    job: {
      jobNumber: payment.job.jobNumber,
      title: payment.job.title,
      contractAmount: Number(payment.job.contractAmount),
      balanceDue: Number(payment.job.balanceDue),
    },
    customer: {
      fullName: payment.job.lead.fullName,
      email: payment.job.lead.email,
      address: addr,
    },
  });

  const ab = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(ab).set(pdf);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${payment.job.jobNumber}-${payment.id.slice(-8)}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

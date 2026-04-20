import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { renderInvoicePdf } from "@/lib/pdf/invoice";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const invoice = await prisma.invoice.findUnique({
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
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const addr = [
    invoice.job.lead.propertyAddress1,
    invoice.job.lead.propertyAddress2,
    `${invoice.job.lead.city}, ${invoice.job.lead.state} ${invoice.job.lead.zipCode}`,
  ]
    .filter(Boolean)
    .join(", ");

  const pdf = await renderInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    amount: Number(invoice.amount),
    status: invoice.status,
    notes: invoice.notes,
    job: {
      jobNumber: invoice.job.jobNumber,
      title: invoice.job.title,
      serviceType: invoice.job.serviceType,
      contractAmount: Number(invoice.job.contractAmount),
      depositReceived: Number(invoice.job.depositReceived),
      balanceDue: Number(invoice.job.balanceDue),
    },
    customer: {
      fullName: invoice.job.lead.fullName,
      email: invoice.job.lead.email,
      address: addr,
    },
  });

  const ab = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(ab).set(pdf);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

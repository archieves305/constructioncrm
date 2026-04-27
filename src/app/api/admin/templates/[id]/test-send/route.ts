import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { renderLeadEmail } from "@/lib/email/render-template";
import { renderTemplate } from "@/lib/templates/render";
import { logger } from "@/lib/logger";

const sampleContext = {
  lead: {
    id: "preview-lead",
    firstName: "Sarah",
    lastName: "Johnson",
    fullName: "Sarah Johnson",
    primaryPhone: "(555) 123-4567",
    email: "sarah@example.com",
    city: "Boca Raton",
    addressLine1: "123 Sample Way",
  },
  assignedTo: {
    firstName: "",
    lastName: "",
    signatureHtml: null,
    signatureText: null,
  },
  company: { name: "" },
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email provider not configured" }, { status: 400 });
  }

  const { id } = await params;
  const tpl = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!tpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (tpl.channel !== "EMAIL") {
    return NextResponse.json({ error: "Test send is only supported for EMAIL templates" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { firstName: true, lastName: true, email: true, signatureHtml: true, signatureText: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const brand = await getEmailBrand();
  const context = {
    ...sampleContext,
    assignedTo: {
      firstName: user.firstName,
      lastName: user.lastName,
      signatureHtml: user.signatureHtml,
      signatureText: user.signatureText,
    },
  };
  const rendered = renderLeadEmail({
    templateBody: tpl.templateBody,
    context,
    brand,
    includeUnsubscribe: false,
  });

  try {
    await sendEmail({
      to: user.email,
      subject: `[TEST] ${renderTemplate(tpl.name, { ...context, company: { ...context.company, brand: brand.companyName } })}`,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (err) {
    logger.exception(err, { where: "templates.test-send", templateId: id });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, sentTo: user.email });
}

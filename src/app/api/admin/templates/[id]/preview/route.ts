import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { getEmailBrand } from "@/lib/email/brand";
import { renderLeadEmail } from "@/lib/email/render-template";
import { renderTemplate } from "@/lib/templates/render";

const schema = z
  .object({
    templateBody: z.string().min(1).optional(),
  })
  .optional();

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
    firstName: "Richard",
    lastName: "Carey",
    signatureHtml: null,
    signatureText: null,
  },
  company: { name: "" },
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole("ADMIN", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const v = await validateBody(req, schema as unknown as z.ZodType<{ templateBody?: string } | undefined>);
  if (!v.ok) return v.response;

  let body = v.data?.templateBody;
  let subject = "Template preview";
  let channel: "EMAIL" | "SMS" | "IN_APP" = "EMAIL";

  if (!body) {
    if (id === "draft") {
      return NextResponse.json({ error: "templateBody required for draft preview" }, { status: 400 });
    }
    const tpl = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!tpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    body = tpl.templateBody;
    subject = tpl.name;
    channel = tpl.channel as typeof channel;
  }

  if (channel !== "EMAIL") {
    const interpolated = renderTemplate(body, sampleContext);
    return NextResponse.json({
      channel,
      subject: renderTemplate(subject, sampleContext),
      text: interpolated,
      html: null,
    });
  }

  const brand = await getEmailBrand();
  const rendered = renderLeadEmail({
    templateBody: body,
    context: sampleContext,
    brand,
    includeUnsubscribe: true,
  });
  return NextResponse.json({
    channel,
    subject: renderTemplate(subject, { ...sampleContext, company: { ...sampleContext.company, brand: brand.companyName } }),
    html: rendered.html,
    text: rendered.text,
  });
}

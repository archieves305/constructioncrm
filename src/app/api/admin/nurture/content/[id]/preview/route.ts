import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { getEmailBrand } from "@/lib/email/brand";
import { renderLeadEmail } from "@/lib/email/render-template";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { renderTemplate } from "@/lib/templates/render";
import { canViewNurture } from "@/lib/nurture/access";
import { nurturePreviewSchema } from "@/lib/validators/nurture";

export const SAMPLE_LEAD = {
  lead: { id: "preview-lead", firstName: "Sarah", lastName: "Johnson", fullName: "Sarah Johnson", primaryPhone: "(555) 123-4567", email: "sarah@example.com", city: "Boca Raton", addressLine1: "123 Sample Way" },
  company: { name: "" },
};

/**
 * POST — render a piece against a sample lead as the signed-in user; with
 * `?send=1` also email it to them with a [TEST] subject (no unsubscribe).
 * Body may carry unsaved subject/body; id "draft" previews only the body.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewNurture(session.user.role)) return forbidden();
  const { id } = await params;
  const send = request.nextUrl.searchParams.get("send") === "1";
  const v = await validateBody(request, nurturePreviewSchema);
  if (!v.ok) return v.response;

  let subject = v.data.subject;
  let body = v.data.body;
  if (id !== "draft") {
    const row = await prisma.nurtureContent.findUnique({ where: { id }, select: { subject: true, body: true } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    subject = subject ?? row.subject;
    body = body ?? row.body;
  }
  if (!body) return NextResponse.json({ error: "Nothing to preview" }, { status: 400 });

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true, email: true, signatureHtml: true, signatureText: true } });
  const brand = await getEmailBrand();
  const context = { ...SAMPLE_LEAD, assignedTo: { firstName: me?.firstName ?? "", lastName: me?.lastName ?? "", signatureHtml: me?.signatureHtml ?? null, signatureText: me?.signatureText ?? null } };
  const rendered = renderLeadEmail({ templateBody: body, context, brand, includeUnsubscribe: !send });
  const renderedSubject = renderTemplate(subject ?? "Preview", { ...context, company: { ...context.company, brand: brand.companyName } });

  if (send) {
    if (!isEmailConfigured()) return NextResponse.json({ error: "Email provider not configured" }, { status: 400 });
    if (!me?.email) return NextResponse.json({ error: "Your user has no email address" }, { status: 400 });
    await sendEmail({ to: me.email, subject: `[TEST] ${renderedSubject}`, html: rendered.html, text: rendered.text, replyTo: me.email });
    return NextResponse.json({ ok: true, sentTo: me.email, subject: renderedSubject });
  }
  return NextResponse.json({ subject: renderedSubject, html: rendered.html, text: rendered.text });
}

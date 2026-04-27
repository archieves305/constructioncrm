import { renderTemplate } from "@/lib/templates/render";
import { markdownToHtml, stripMarkdown } from "./markdown";
import { renderEmailLayout } from "./layout";
import { EmailBrand, formatBrandAddress } from "./brand";
import { buildUnsubscribeUrl } from "./unsubscribe";

export type LeadTemplateContext = {
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    primaryPhone: string;
    email: string;
    city: string;
    addressLine1: string;
  };
  assignedTo: {
    firstName: string;
    lastName: string;
    signatureHtml?: string | null;
    signatureText?: string | null;
  };
  company: { name: string };
};

function buildTemplateVarContext(
  ctx: LeadTemplateContext,
  brand: EmailBrand,
  unsubscribeUrl: string | null,
): Record<string, unknown> {
  return {
    ...ctx,
    company: {
      ...ctx.company,
      brand: brand.companyName,
      phone: brand.officePhone ?? "",
      mobile: brand.mobilePhone ?? "",
      email: brand.contactEmail ?? "",
      website: brand.website ?? "",
      address: formatBrandAddress(brand),
    },
    unsubscribeUrl: unsubscribeUrl ?? "",
  };
}

export function renderLeadEmail(opts: {
  templateBody: string;
  context: LeadTemplateContext;
  brand: EmailBrand;
  includeUnsubscribe?: boolean;
}): { html: string; text: string } {
  const unsubscribeUrl = opts.includeUnsubscribe
    ? buildUnsubscribeUrl(opts.context.lead.id)
    : null;

  const vars = buildTemplateVarContext(opts.context, opts.brand, unsubscribeUrl);
  const interpolatedMarkdown = renderTemplate(opts.templateBody, vars);
  const bodyHtml = markdownToHtml(interpolatedMarkdown);
  const bodyText = stripMarkdown(interpolatedMarkdown);

  return renderEmailLayout({
    bodyHtml,
    bodyText,
    brand: opts.brand,
    signatureHtml: opts.context.assignedTo.signatureHtml ?? null,
    signatureText: opts.context.assignedTo.signatureText ?? null,
    unsubscribeUrl,
  });
}

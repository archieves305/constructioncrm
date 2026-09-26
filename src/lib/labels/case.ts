import { formatAddressLine } from "./address";
import { customerName, type CustomerInput, type EntityLabel } from "./job";

export type CaseLabelInput = {
  caseNumber: string;
  title?: string | null;
  lead?: CustomerInput | null;
};

export function caseLabel(c: CaseLabelInput): EntityLabel {
  const address = formatAddressLine(c.lead);
  const context = [customerName(c.lead), (c.title ?? "").trim()].filter(Boolean).join(" · ") || null;
  if (address) return { primary: address, secondary: context, code: c.caseNumber, placeholder: false };
  const title = (c.title ?? "").trim();
  if (title) return { primary: title, secondary: customerName(c.lead) || null, code: c.caseNumber, placeholder: true };
  return { primary: c.caseNumber, secondary: context, code: null, placeholder: true };
}

/** "2192 Wind Trace, Navarre (CV-00003)". */
export function caseText(c: CaseLabelInput): string {
  const l = caseLabel(c);
  return l.code ? `${l.primary} (${l.code})` : l.primary;
}

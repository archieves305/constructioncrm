/**
 * The kinds of document a permit carries. Pure and client-safe. The key is
 * stored on `File.permitDocType` and on a requirement (`PermitKnowledge.documentType`).
 *
 * `sealed`: signed and sealed by an architect or engineer — the CRM never
 * alters one; a revision is a new file from its author.
 */
export type PermitDocGroup = "application" | "owner" | "contractor" | "design" | "products" | "review" | "issued" | "other";

export type PermitDocType = { key: string; label: string; group: PermitDocGroup; sealed?: boolean };

export const PERMIT_DOC_TYPES: readonly PermitDocType[] = [
  { key: "blank_application", label: "Blank application form", group: "application" },
  { key: "completed_application", label: "Completed application", group: "application" },
  { key: "notice_of_commencement", label: "Notice of commencement", group: "owner" },
  { key: "owner_authorization", label: "Owner authorization", group: "owner" },
  { key: "contractor_registration", label: "Contractor registration", group: "contractor" },
  { key: "architectural_plans", label: "Architectural plans", group: "design", sealed: true },
  { key: "structural_plans", label: "Structural plans", group: "design", sealed: true },
  { key: "engineering_letter", label: "Engineering letter", group: "design", sealed: true },
  { key: "energy_calculations", label: "Energy calculations", group: "design", sealed: true },
  { key: "wind_load", label: "Wind-load calculations", group: "design", sealed: true },
  { key: "survey", label: "Survey", group: "design", sealed: true },
  { key: "site_plan", label: "Site plan", group: "design" },
  { key: "product_approval", label: "Product approval / NOA", group: "products" },
  { key: "installation_instructions", label: "Installation instructions", group: "products" },
  { key: "correction_notice", label: "Correction notice", group: "review" },
  { key: "correction_response", label: "Correction response", group: "review" },
  { key: "revised_plans", label: "Revised plans", group: "review", sealed: true },
  { key: "approved_permit", label: "Approved permit", group: "issued" },
  { key: "stamped_plans", label: "Stamped approved plans", group: "issued" },
  { key: "inspection_report", label: "Inspection report", group: "issued" },
  { key: "fee_receipt", label: "Fee receipt", group: "issued" },
  { key: "closeout", label: "Closeout document", group: "issued" },
  { key: "other", label: "Other", group: "other" },
];

export const PERMIT_DOC_GROUP_LABEL: Record<PermitDocGroup, string> = {
  application: "Application",
  owner: "Owner",
  contractor: "Contractor",
  design: "Plans and design",
  products: "Products",
  review: "Review",
  issued: "Issued and inspections",
  other: "Other",
};

const BY_KEY = new Map(PERMIT_DOC_TYPES.map((t) => [t.key, t]));

export function isPermitDocType(v: unknown): v is string {
  return typeof v === "string" && BY_KEY.has(v);
}

export function permitDocType(key: string | null | undefined): PermitDocType | null {
  return key ? (BY_KEY.get(key) ?? null) : null;
}

export function permitDocLabel(key: string | null | undefined): string {
  return permitDocType(key)?.label ?? "Unclassified";
}

/** Issued records a building department stamped: never deleted, renamed or replaced here. */
export function isIssuedRecord(key: string | null | undefined): boolean {
  return key === "approved_permit" || key === "stamped_plans";
}

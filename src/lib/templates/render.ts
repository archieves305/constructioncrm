type Dict = Record<string, unknown>;

export function renderTemplate(template: string, context: Dict): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as Dict)) {
        return (acc as Dict)[key];
      }
      return undefined;
    }, context);
    return value == null ? "" : String(value);
  });
}

export const TEMPLATE_VARIABLES = [
  "lead.firstName",
  "lead.lastName",
  "lead.fullName",
  "lead.primaryPhone",
  "lead.email",
  "lead.city",
  "lead.addressLine1",
  "assignedTo.firstName",
  "assignedTo.lastName",
  "company.name",
  "company.brand",
  "company.phone",
  "company.mobile",
  "company.email",
  "company.website",
  "company.address",
  "permit.municipality",
  "permit.permitNumber",
  "permit.permitType",
  "permit.status",
  "permit.submittedDate",
  "permit.expectedApprovalDate",
  "permit.approvedDate",
  "permit.expirationDate",
  "permit.agingDays",
  "permit.inspectorName",
  "inspection.type",
  "inspection.scheduledFor",
  "inspection.scheduledTime",
  "inspection.completedAt",
  "inspection.result",
  "inspection.inspectorName",
  "unsubscribeUrl",
];

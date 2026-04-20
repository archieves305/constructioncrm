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
];

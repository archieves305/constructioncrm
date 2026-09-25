/**
 * Turn the API's `{ "sections.2.items.1.description": ["Too big…"] }` into
 * sentences a person can act on ("Section 3 “Kitchen”, item 2 — description:
 * too big…"). Client-safe: no Prisma, no server imports.
 */

type FormLike = { sections?: { title?: string; items?: { description?: string }[] }[] };

const FIELD_LABEL: Record<string, string> = {
  name: "Estimate name",
  marginPercent: "Margin",
  discountPercent: "Discount",
  salesTaxPercent: "Sales tax",
  validityDays: "Valid for (days)",
  notes: "Notes",
  exclusions: "Exclusions",
  title: "title",
  description: "description",
  quantity: "quantity",
  unitPrice: "unit price",
  unitType: "unit",
};

function tidy(message: string): string {
  return message.replace(/^Too big: expected string to have <=(\d+) characters$/, "longer than $1 characters").replace(/^Too small: expected string to have >=1 characters$/, "is required").replace(/^Invalid input: expected number, received (\w+)$/, "must be a number");
}

export function describeEstimateValidationErrors(fields: Record<string, string[]>, form?: FormLike | null): string[] {
  const out: string[] = [];
  for (const [path, messages] of Object.entries(fields)) {
    const parts = path.split(".");
    let where = "";
    let field = path;
    if (parts[0] === "sections" && parts.length >= 2) {
      const s = Number(parts[1]);
      const section = form?.sections?.[s];
      where = `Section ${s + 1}${section?.title ? ` “${section.title.slice(0, 40)}”` : ""}`;
      if (parts[2] === "items" && parts.length >= 4) {
        const i = Number(parts[3]);
        const item = section?.items?.[i];
        where += `, item ${i + 1}${item?.description ? ` “${item.description.slice(0, 30)}${item.description.length > 30 ? "…" : ""}”` : ""}`;
        field = parts[4] ?? "";
      } else {
        field = parts[2] ?? "";
      }
    } else if (path === "_root") {
      field = "";
    }
    const label = FIELD_LABEL[field] ?? field;
    for (const m of messages) out.push(`${where ? `${where} — ` : ""}${label ? `${label} ` : ""}${tidy(m)}`.trim());
  }
  return out;
}

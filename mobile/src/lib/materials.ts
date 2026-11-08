import type { MaterialLine } from "@crm/mobile-api";

/** A line as people say it: "12 sheets 5/8 drywall". */
export function lineText(l: MaterialLine): string {
  return [l.qty, l.unit, l.item].map((x) => x.trim()).filter(Boolean).join(" ");
}

export function filledLines(lines: MaterialLine[]): MaterialLine[] {
  return lines.filter((l) => l.item.trim());
}

/** The request's title: the first line, and how many more. */
export function materialsTitle(lines: MaterialLine[]): string {
  const f = filledLines(lines);
  if (!f.length) return "";
  const first = lineText(f[0]).slice(0, 160);
  return f.length > 1 ? `${first} + ${f.length - 1} more` : first;
}

/** The request's text for the office: every line, when, where, and any notes. */
export function materialsText(lines: MaterialLine[], neededBy: string | null, deliverTo: string, notes: string): string {
  const parts = [filledLines(lines).map((l) => `• ${lineText(l)}`).join("\n")];
  if (neededBy) parts.push(`Needed on site by ${neededBy}.`);
  if (deliverTo.trim()) parts.push(`Deliver to: ${deliverTo.trim()}`);
  if (notes.trim()) parts.push(notes.trim());
  return parts.join("\n\n");
}

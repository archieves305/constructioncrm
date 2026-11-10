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

/** What a material request's status means to the crew that asked. */
export const MATERIAL_STATUS: Record<string, string> = {
  PENDING: "Requested",
  IN_PROGRESS: "Ordered",
  BLOCKED: "Held up",
  COMPLETED: "Delivered",
  CANCELLED: "Cancelled",
};

/**
 * Items asked for before on this job, newest first and each once, read from
 * the requests' bullet lines ("• 12 sheets 5/8 drywall"), to ask again in one tap.
 */
export function pastItems(requests: { description: string | null; createdAt: string }[], max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    for (const line of (r.description ?? "").split("\n")) {
      const m = /^\s*•\s*(.+)$/.exec(line);
      if (!m) continue;
      const text = m[1].trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= max) return out;
    }
  }
  return out;
}

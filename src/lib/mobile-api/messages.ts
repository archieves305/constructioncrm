/**
 * Plain sentences for validation failures. Pure (no imports), shared with the
 * phone app through @crm/mobile-api.
 * `fetchJson` uses it to turn `{ error: "Validation failed", fields }` into the
 * field's own message, and routes that answer one message use it on zod issues.
 */

/** "customerPrice" / "customer_price" / "lines.0.unitPrice" → "Customer price" / "Unit price". */
export function fieldLabel(path: string): string {
  const last = path.split(".").filter((p) => p && !/^\d+$/.test(p)).pop() ?? path;
  if (!last || last === "_root") return "";
  const words = last
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bId\b/, "")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * zod's default wording ("Too small: expected number to be >=0") as the end of a
 * sentence about the field ("must be 0 or more"). Returns null for a message a
 * schema wrote itself, which is kept as it is.
 */
export function plainZodMessage(message: string): string | null {
  const m = message.trim();
  if (/^Required$/i.test(m) || /received (undefined|null)$/i.test(m)) return "is required";
  let r = m.match(/^Too small: expected number to be >(=?)(-?[\d.]+)/i);
  if (r) return r[1] ? (r[2] === "0" ? "must be 0 or more" : `must be at least ${r[2]}`) : `must be greater than ${r[2]}`;
  r = m.match(/^Too big: expected number to be <(=?)(-?[\d.]+)/i);
  if (r) return r[1] ? `must be at most ${r[2]}` : `must be less than ${r[2]}`;
  r = m.match(/^Too small: expected string to have >=?(\d+) characters?/i);
  if (r) return r[1] === "1" ? "is required" : `must be at least ${r[1]} characters`;
  r = m.match(/^Too big: expected string to have <=?(\d+) characters?/i);
  if (r) return `must be at most ${r[1]} characters`;
  r = m.match(/^Too small: expected array to have >=?(\d+) items?/i);
  if (r) return r[1] === "1" ? "needs at least one entry" : `needs at least ${r[1]} entries`;
  if (/^Invalid input: expected number/i.test(m)) return "must be a number";
  if (/^Invalid input: expected (string|boolean|date)/i.test(m)) return "is not valid";
  if (/^Invalid option/i.test(m) || /^Invalid enum value/i.test(m)) return "is not one of the allowed choices";
  if (/^Invalid (email|url|date|datetime)/i.test(m)) return "is not valid";
  return null;
}

/** One sentence for one field: "Amount must be 0 or more", "City: Enter a city". */
export function fieldMessage(path: string, message: string): string {
  const label = fieldLabel(path);
  const plain = plainZodMessage(message);
  if (!label) return plain ? `The request ${plain}` : message;
  if (plain) return `${label} ${plain}`;
  // A schema's own sentence that already names the field stands alone.
  return message.toLowerCase().startsWith(label.toLowerCase()) ? message : `${label}: ${message}`;
}

/** The first problem in a `validateBody` `fields` map, as a sentence. */
export function firstFieldMessage(fields: unknown): string | null {
  if (!fields || typeof fields !== "object") return null;
  for (const [path, msgs] of Object.entries(fields as Record<string, unknown>)) {
    const first = Array.isArray(msgs) ? msgs.find((x) => typeof x === "string") : typeof msgs === "string" ? msgs : null;
    if (first) return fieldMessage(path, first);
  }
  return null;
}

/** The first zod issue as a sentence (routes that answer a single `error`). */
export function firstIssueMessage(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  const issue = issues[0];
  if (!issue) return "The request is not valid";
  return fieldMessage(issue.path.map(String).join("."), issue.message);
}

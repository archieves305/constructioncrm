/** "LEAD_STAGE_CHANGED" → "Lead stage changed". For enum values with no label registry yet. */
export function enumLabel(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `{ VALUE: "Value" }` for a list of enum values, for a Select's `items`. */
export function enumItems(values: readonly string[]): Record<string, string> {
  return Object.fromEntries(values.map((v) => [v, enumLabel(v)]));
}

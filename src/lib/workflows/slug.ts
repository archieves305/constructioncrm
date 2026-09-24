/** "Submit permit package" → "submit_permit_package". Pure; safe for the client. */
export function slugKey(text: string): string {
  const k = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]/, "p$&");
  return k || "step";
}

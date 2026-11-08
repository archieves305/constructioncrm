import type { LeadLabelDto } from "@crm/mobile-api";

/** The CRM keeps its days in the office's time zone (APP_TIME_ZONE). */
export const OFFICE_TZ = "America/New_York";

/** yyyy-MM-dd for an instant, in the office's time zone. */
export function dayKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: OFFICE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA formats as yyyy-MM-dd
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return t.toISOString().slice(0, 10);
}

/** "3310 NE 37 St, Fort Lauderdale": address first, as everywhere in the CRM. */
export function addressLine(lead: LeadLabelDto | null | undefined): string | null {
  if (!lead) return null;
  const street = [lead.propertyAddress1, lead.propertyAddress2].filter(Boolean).join(" ");
  return [street, lead.city].filter(Boolean).join(", ") || null;
}

export function fullAddress(lead: LeadLabelDto | null | undefined): string | null {
  if (!lead) return null;
  return [addressLine(lead), [lead.state, lead.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
}

export function time(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: OFFICE_TZ });
}

export function shortDate(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: OFFICE_TZ });
}

/** Digits only, for a tel: link. Null when there is nothing dialable. */
export function dialable(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? digits : null;
}

/** A maps link the phone opens in Apple Maps / Google Maps. */
export function mapsUrl(address: string, platform: "ios" | "android"): string {
  const q = encodeURIComponent(address);
  return platform === "ios" ? `https://maps.apple.com/?daddr=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

export function personName(p: { firstName: string; lastName: string } | null | undefined): string | null {
  return p ? `${p.firstName} ${p.lastName}`.trim() : null;
}

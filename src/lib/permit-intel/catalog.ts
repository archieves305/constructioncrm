/**
 * The permit-type catalog and jurisdiction names. Pure and client-safe. The
 * catalog is seeded into `PermitTypeDef` (prisma/seed-permit-intel.ts); the
 * matchers read the free text typed on permits before records existed.
 */
export const PERMIT_TYPE_SEED: readonly { key: string; name: string }[] = [
  { key: "building", name: "Building" },
  { key: "reroof", name: "Re-Roof" },
  { key: "interior_renovation", name: "Interior Renovation" },
  { key: "windows_doors", name: "Windows and Doors" },
  { key: "electrical", name: "Electrical" },
  { key: "plumbing", name: "Plumbing" },
  { key: "mechanical", name: "Mechanical" },
  { key: "demolition", name: "Demolition" },
  { key: "other", name: "Other" },
];

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The catalog key a permit's typed type means. A permit that names several
 * trades and "building" is the building permit; a single trade is that trade.
 * Null when nothing matches.
 */
export function permitTypeKeyFor(text: string | null | undefined): string | null {
  if (!text) return null;
  const w = ` ${words(text)} `;
  if (/\bre ?roof|\broof/.test(w)) return "reroof";
  if (/\binterior\b|\brenovation\b|\bremodel/.test(w)) return "interior_renovation";
  if (/\bwindows?\b|\bdoors?\b|\bshutters?\b/.test(w)) return "windows_doors";
  if (/\bbuilding\b/.test(w)) return "building";
  if (/\bdemoli/.test(w)) return "demolition";
  const trades = ["electrical", "plumbing", "mechanical"].filter((t) => w.includes(` ${t} `));
  if (trades.length === 1) return trades[0];
  if (trades.length > 1) return "building";
  return null;
}

/** The stable key of a jurisdiction: "City of Palm Beach" → "city-of-palm-beach". */
export function jurisdictionKey(name: string): string {
  return words(name).replace(/ /g, "-");
}

/** "City Of Miami" and "city of miami " are the same department. */
export function sameJurisdictionName(a: string, b: string): boolean {
  return jurisdictionKey(a) === jurisdictionKey(b);
}

/** The kind a name says, for a jurisdiction created from typed text. */
export function jurisdictionKindFor(name: string): "CITY" | "TOWN" | "VILLAGE" | "COUNTY" | "OTHER" {
  const w = ` ${words(name)} `;
  if (w.includes(" county ")) return "COUNTY";
  if (w.includes(" town ")) return "TOWN";
  if (w.includes(" village ")) return "VILLAGE";
  if (w.includes(" city ")) return "CITY";
  return "OTHER";
}

/** Tidy typed text into a display name: "City Of Miami" → "City of Miami". */
export function tidyJurisdictionName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part, i) => (i > 0 && /^(of|the)$/i.test(part) ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

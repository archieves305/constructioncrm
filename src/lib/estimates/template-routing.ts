// Maps a lead's "Services Needed" (ServiceCategory names) to the estimate
// template category that should be created. Pure + unit-tested.
//
// ROOFING routes to the existing specialized roofing form; the other three
// categories route to the generic template-driven builder.

import type { EstimateTemplateCategory } from "@/generated/prisma/enums";

export type LeadServiceLike = {
  serviceCategory: { name: string; parentId?: string | null };
};

// Canonical top-level category names from the seed (prisma/seed.ts).
const NAME_TO_CATEGORY: Record<string, EstimateTemplateCategory> = {
  roofing: "ROOFING",
  drywall: "DRYWALL",
  "interior renovations": "INTERIOR_RENOVATION",
  "interior renovation": "INTERIOR_RENOVATION",
  windows: "WINDOWS_DOORS",
  doors: "WINDOWS_DOORS",
};

// Substring fallback so child categories ("Impact Windows", "Kitchen Remodel",
// "Roof Repair", …) or renamed categories still resolve to the right template.
function fallbackCategory(name: string): EstimateTemplateCategory | null {
  const n = name.toLowerCase();
  if (n.includes("roof")) return "ROOFING";
  if (n.includes("window") || n.includes("door")) return "WINDOWS_DOORS";
  if (n.includes("drywall")) return "DRYWALL";
  if (
    n.includes("interior") ||
    n.includes("renovat") ||
    n.includes("kitchen") ||
    n.includes("bath") ||
    n.includes("floor") ||
    n.includes("paint")
  ) {
    return "INTERIOR_RENOVATION";
  }
  return null;
}

export function categoryForServiceName(
  name: string,
): EstimateTemplateCategory | null {
  const exact = NAME_TO_CATEGORY[name.trim().toLowerCase()];
  if (exact) return exact;
  return fallbackCategory(name);
}

// Distinct, ordered set of template categories applicable to a lead's services.
export function categoriesForLeadServices(
  services: LeadServiceLike[],
): EstimateTemplateCategory[] {
  const seen = new Set<EstimateTemplateCategory>();
  const ordered: EstimateTemplateCategory[] = [];
  for (const s of services) {
    const cat = categoryForServiceName(s.serviceCategory.name);
    if (cat && !seen.has(cat)) {
      seen.add(cat);
      ordered.push(cat);
    }
  }
  return ordered;
}

export type EstimateRouteDecision =
  | { kind: "roofing" }
  | { kind: "generic"; category: EstimateTemplateCategory }
  | { kind: "picker"; categories: EstimateTemplateCategory[] };

export const ALL_CATEGORIES: EstimateTemplateCategory[] = [
  "ROOFING",
  "DRYWALL",
  "INTERIOR_RENOVATION",
  "WINDOWS_DOORS",
];

// Decide what happens when the user clicks "New estimate":
//  - exactly one category, ROOFING       → open the roofing form
//  - exactly one non-roofing category    → open the generic builder for it
//  - multiple, or no services            → show a picker (defaults to all 4)
export function decideEstimateRoute(
  services: LeadServiceLike[],
): EstimateRouteDecision {
  const categories = categoriesForLeadServices(services);
  if (categories.length === 0) {
    return { kind: "picker", categories: ALL_CATEGORIES };
  }
  if (categories.length === 1) {
    return categories[0] === "ROOFING"
      ? { kind: "roofing" }
      : { kind: "generic", category: categories[0] };
  }
  return { kind: "picker", categories };
}

import type { RoleName } from "@/generated/prisma/client";

const DISPLAY: Record<RoleName, string> = {
  ADMIN: "Admin",
  MANAGER: "Sales Manager",
  SALES_REP: "Sales Executive",
  OFFICE_STAFF: "Accounting",
  MARKETING: "Marketing",
  READ_ONLY: "Read Only",
  CREW_LEAD: "Crew Lead",
};

const DESCRIPTIONS: Record<RoleName, string> = {
  ADMIN: "Full access to everything.",
  MANAGER: "Full access to everything.",
  SALES_REP: "Access limited to their own leads and jobs.",
  OFFICE_STAFF: "Full access to everything.",
  MARKETING: "Reports and source data.",
  READ_ONLY: "View-only system access.",
  CREW_LEAD:
    "Field access to assigned jobs: daily logs, hours, photos, issues. No financials.",
};

export const SELECTABLE_ROLES: RoleName[] = [
  "ADMIN",
  "MANAGER",
  "SALES_REP",
  "OFFICE_STAFF",
  "CREW_LEAD",
];

export function roleDisplayName(name: RoleName): string {
  return DISPLAY[name];
}

export function roleDescription(name: RoleName): string {
  return DESCRIPTIONS[name];
}

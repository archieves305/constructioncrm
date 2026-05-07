import type { RoleName } from "@/generated/prisma/client";

const DISPLAY: Record<RoleName, string> = {
  ADMIN: "Admin",
  MANAGER: "Sales Manager",
  SALES_REP: "Sales Executive",
  OFFICE_STAFF: "Accounting",
  MARKETING: "Marketing",
  READ_ONLY: "Read Only",
};

const DESCRIPTIONS: Record<RoleName, string> = {
  ADMIN: "Full access to everything.",
  MANAGER: "Full access to everything.",
  SALES_REP: "Access limited to their own leads and jobs.",
  OFFICE_STAFF: "Full access to everything.",
  MARKETING: "Reports and source data.",
  READ_ONLY: "View-only system access.",
};

export const SELECTABLE_ROLES: RoleName[] = [
  "ADMIN",
  "MANAGER",
  "SALES_REP",
  "OFFICE_STAFF",
];

export function roleDisplayName(name: RoleName): string {
  return DISPLAY[name];
}

export function roleDescription(name: RoleName): string {
  return DESCRIPTIONS[name];
}

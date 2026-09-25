import type { RoleName } from "@/generated/prisma/client";

// Explicit role lists, never hasMinRole: ROLE_HIERARCHY ranks SALES_REP
// above OFFICE_STAFF, and a signed contract moves the job's contract sum.

/** Create, regenerate, send, resend, void a DRAFT or SENT contract. */
export const CONTRACT_MANAGE_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP"];
/** Void a SIGNED contract — reverses money. */
export const CONTRACT_VOID_SIGNED_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];
export const CONTRACT_VIEW_ROLES: readonly RoleName[] = [...CONTRACT_MANAGE_ROLES, "READ_ONLY"];
export const CONTRACT_TEMPLATE_MANAGE_ROLES: readonly RoleName[] = ["ADMIN"];
export const CONTRACT_TEMPLATE_VIEW_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

export function canManageContracts(role: RoleName): boolean {
  return CONTRACT_MANAGE_ROLES.includes(role);
}
export function canVoidSignedContract(role: RoleName): boolean {
  return CONTRACT_VOID_SIGNED_ROLES.includes(role);
}
export function canViewContracts(role: RoleName): boolean {
  return CONTRACT_VIEW_ROLES.includes(role);
}
export function canManageContractTemplates(role: RoleName): boolean {
  return CONTRACT_TEMPLATE_MANAGE_ROLES.includes(role);
}
export function canViewContractTemplates(role: RoleName): boolean {
  return CONTRACT_TEMPLATE_VIEW_ROLES.includes(role);
}

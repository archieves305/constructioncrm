import type { DocumentConfidentiality, RoleName } from "@/generated/prisma/client";
import { PARTNER_VIEW_ROLES } from "./access";

/**
 * Who may read, upload and classify the documents in KNU's vault.
 *
 * SHAREABLE: anyone who can open Business Development. INTERNAL: the same
 * minus MARKETING. RESTRICTED (financial statements, banking letters, the
 * W-9): ADMIN always, MANAGER and OFFICE_STAFF only with the
 * `canViewRestrictedDocuments` grant — and every read is audited. Explicit
 * lists, never `hasMinRole`. Pure and client-safe.
 */
export type VaultViewer = { role: RoleName | null | undefined; canViewRestrictedDocuments?: boolean };

const INTERNAL_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "READ_ONLY"];
const RESTRICTED_GRANT_ROLES: readonly RoleName[] = ["MANAGER", "OFFICE_STAFF"];
const UPLOAD_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];
const CLASSIFY_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];

const has = (list: readonly RoleName[], role: RoleName | null | undefined) => Boolean(role) && list.includes(role as RoleName);

export function canReadDocument(viewer: VaultViewer, confidentiality: DocumentConfidentiality): boolean {
  switch (confidentiality) {
    case "SHAREABLE":
      return has(PARTNER_VIEW_ROLES, viewer.role);
    case "INTERNAL":
      return has(INTERNAL_ROLES, viewer.role);
    case "RESTRICTED":
      return viewer.role === "ADMIN" || (has(RESTRICTED_GRANT_ROLES, viewer.role) && viewer.canViewRestrictedDocuments === true);
  }
}

/** Upload a document or a new version, correct its dates and notes. */
export function canUploadVault(role: RoleName | null | undefined): boolean {
  return has(UPLOAD_ROLES, role);
}

/** Change a document's confidentiality or mark it approved for external distribution; delete one. */
export function canClassifyVault(role: RoleName | null | undefined): boolean {
  return has(CLASSIFY_ROLES, role);
}

/** Uploading RESTRICTED material needs the right to read it afterwards. */
export function canUploadRestricted(viewer: VaultViewer): boolean {
  return canUploadVault(viewer.role) && canReadDocument(viewer, "RESTRICTED");
}

export const CONFIDENTIALITY_LABEL: Record<DocumentConfidentiality, string> = { INTERNAL: "Internal", RESTRICTED: "Restricted", SHAREABLE: "Shareable" };
export const CONFIDENTIALITY_HINT: Record<DocumentConfidentiality, string> = {
  INTERNAL: "Staff may open it; never sent out as is.",
  RESTRICTED: "Financials, banking, tax forms: admins and people with the grant only, every read logged, encrypted on disk.",
  SHAREABLE: "Safe to send to a general contractor.",
};

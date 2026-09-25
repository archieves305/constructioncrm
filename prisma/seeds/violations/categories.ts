import type { WorkflowPermitStatus } from "../../../src/generated/prisma/client";

/**
 * The initial code-violation categories. A table, not an enum, so admins can
 * add or rename without a deploy; keyed so re-seeding is idempotent and items
 * keep their category through a rename.
 */
export type ViolationCategorySeed = {
  key: string;
  name: string;
  defaultResponsibleTrade?: string;
  defaultPermitRequirement?: WorkflowPermitStatus;
  /** Usually means corrective construction on a linked job. */
  defaultConstructionRequired?: boolean;
};

export const VIOLATION_CATEGORIES: readonly ViolationCategorySeed[] = [
  { key: "roofing", name: "Roofing", defaultResponsibleTrade: "Roofing", defaultPermitRequirement: "REQUIRED", defaultConstructionRequired: true },
  { key: "structural", name: "Structural", defaultResponsibleTrade: "General", defaultPermitRequirement: "REQUIRED", defaultConstructionRequired: true },
  { key: "electrical", name: "Electrical", defaultResponsibleTrade: "Electrical", defaultPermitRequirement: "REQUIRED", defaultConstructionRequired: true },
  { key: "plumbing", name: "Plumbing", defaultResponsibleTrade: "Plumbing", defaultPermitRequirement: "REQUIRED", defaultConstructionRequired: true },
  { key: "hvac_mechanical", name: "HVAC / mechanical", defaultResponsibleTrade: "HVAC", defaultPermitRequirement: "REQUIRED", defaultConstructionRequired: true },
  { key: "fire_safety", name: "Fire safety", defaultResponsibleTrade: "General", defaultConstructionRequired: true },
  { key: "unsafe_structure", name: "Unsafe structure", defaultResponsibleTrade: "General", defaultPermitRequirement: "REQUIRED", defaultConstructionRequired: true },
  { key: "windows_doors", name: "Windows and doors", defaultResponsibleTrade: "Doors & Windows", defaultPermitRequirement: "REQUIRED", defaultConstructionRequired: true },
  { key: "interior_renovation", name: "Interior renovation", defaultResponsibleTrade: "Interior Renovation", defaultConstructionRequired: true },
  { key: "exterior_maintenance", name: "Exterior maintenance", defaultResponsibleTrade: "General", defaultConstructionRequired: true },
  { key: "landscaping_overgrowth", name: "Landscaping / overgrowth", defaultResponsibleTrade: "Landscaping", defaultPermitRequirement: "NOT_REQUIRED" },
  { key: "trash_debris", name: "Trash / debris", defaultResponsibleTrade: "General", defaultPermitRequirement: "NOT_REQUIRED" },
  { key: "pool_fence", name: "Pool / fence", defaultResponsibleTrade: "General", defaultConstructionRequired: true },
  { key: "zoning", name: "Zoning" },
  { key: "unpermitted_use", name: "Unpermitted use" },
  { key: "work_without_permit", name: "Work without permit", defaultPermitRequirement: "REQUIRED", defaultConstructionRequired: true },
  { key: "expired_permit", name: "Expired permit", defaultPermitRequirement: "REQUIRED" },
  { key: "certificate_of_occupancy", name: "Certificate of occupancy" },
  { key: "rental_licensing", name: "Rental licensing" },
  { key: "signage", name: "Signage" },
  { key: "parking_vehicle_storage", name: "Parking / vehicle storage", defaultPermitRequirement: "NOT_REQUIRED" },
  { key: "other", name: "Other" },
];

import type { RoleName } from "@/generated/prisma/client";
import { canReadPersonnel, canSeeLaborCosts } from "./permissions";

// Single choke point that shapes personnel records per viewer before they
// leave the API. Sensitive material is OMITTED server-side (never sent and
// hidden client-side): SSN ciphertext never leaves the server at all; rates
// only go to cost-visible roles; CREW_LEAD/READ_ONLY get roster fields only.

type PersonnelRecord = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  trade: string | null;
  title: string | null;
  hourlyRate: unknown;
  employmentType: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  entityName: string | null;
  crewId: string | null;
  userId: string | null;
  notes: string | null;
  isActive: boolean;
  ssnLast4: string | null;
  createdAt: Date;
  updatedAt: Date;
  crew?: { id: string; name: string } | null;
  documents?: unknown[];
};

export function serializePersonnel(
  record: PersonnelRecord,
  viewerRole: RoleName,
) {
  if (!canReadPersonnel(viewerRole)) return null;

  const rosterView = viewerRole === "CREW_LEAD" || viewerRole === "READ_ONLY";
  if (rosterView) {
    return {
      id: record.id,
      firstName: record.firstName,
      lastName: record.lastName,
      trade: record.trade,
      title: record.title,
      employmentType: record.employmentType,
      status: record.status,
      crewId: record.crewId,
      crew: record.crew ?? null,
      isActive: record.isActive,
    };
  }

  // Destructure the record so ciphertext material can never ride along on a
  // spread — Prisma rows include every scalar column.
  const {
    hourlyRate,
    ssnLast4,
    ssnCiphertext: _ssnCiphertext,
    ssnKeyVersion: _ssnKeyVersion,
    ...base
  } = record as PersonnelRecord & {
    ssnCiphertext?: string | null;
    ssnKeyVersion?: number | null;
  };

  return {
    ...base,
    ssnLast4,
    hasSsn: Boolean(ssnLast4),
    ...(canSeeLaborCosts(viewerRole) ? { hourlyRate } : {}),
  };
}

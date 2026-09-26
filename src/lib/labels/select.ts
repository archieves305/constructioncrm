import type { Prisma } from "@/generated/prisma/client";

/**
 * The fields a label needs, as Prisma selects. Type-only import: this file
 * is safe to reach from client components.
 */
export const LEAD_LABEL_SELECT = {
  id: true,
  fullName: true,
  companyName: true,
  propertyAddress1: true,
  propertyAddress2: true,
  city: true,
  state: true,
  zipCode: true,
} satisfies Prisma.LeadSelect;

export const JOB_LABEL_SELECT = {
  id: true,
  jobNumber: true,
  title: true,
  serviceType: true,
  lead: { select: LEAD_LABEL_SELECT },
} satisfies Prisma.JobSelect;

export const CASE_LABEL_SELECT = {
  id: true,
  caseNumber: true,
  agencyCaseNumber: true,
  title: true,
  leadId: true,
  lead: { select: LEAD_LABEL_SELECT },
} satisfies Prisma.CodeViolationCaseSelect;

export type LeadLabelRow = Prisma.LeadGetPayload<{ select: typeof LEAD_LABEL_SELECT }>;
export type JobLabelRow = Prisma.JobGetPayload<{ select: typeof JOB_LABEL_SELECT }>;
export type CaseLabelRow = Prisma.CodeViolationCaseGetPayload<{ select: typeof CASE_LABEL_SELECT }>;

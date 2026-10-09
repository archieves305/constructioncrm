import { z } from "zod";
import { DISCIPLINES } from "./types";

const trimmed = (max: number) => z.string().trim().max(max);

export const createPlanSetSchema = z.object({
  leadId: z.string().min(1),
  jobId: z.string().min(1).nullish(),
  name: trimmed(120).min(1).default("Plan set"),
});

export const patchPlanSetSchema = z
  .object({
    name: trimmed(120).min(1).optional(),
    notes: trimmed(2000).nullable().optional(),
    jobId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const DOCUMENT_KINDS = ["FULL_SET", "PARTIAL", "ADDENDUM", "REVISION"] as const;

export const documentFieldsSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS).default("FULL_SET"),
  label: trimmed(120).min(1).default("Plan set"),
  revisionLabel: trimmed(40).nullable().optional(),
});

export const patchSheetSchema = z
  .object({
    sheetNumber: trimmed(20).nullable().optional(),
    title: trimmed(160).nullable().optional(),
    discipline: z.enum(DISCIPLINES as [string, ...string[]]).optional(),
    scaleText: trimmed(40).nullable().optional(),
    revisionLabel: trimmed(40).nullable().optional(),
    supersededBySheetId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export type PatchSheetInput = z.infer<typeof patchSheetSchema>;

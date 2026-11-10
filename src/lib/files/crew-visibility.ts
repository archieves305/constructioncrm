import type { FileCategory, Prisma, RoleName } from "@/generated/prisma/client";
import { fileReadWhere } from "./access";
import { prisma } from "@/lib/db/prisma";

/**
 * Which job files a crew lead may open (crew study, gap S1-1, and Richard's
 * ruling P-6: an admin decides). The admin picks the kinds of file crews see
 * (LaborSettings.crewFileCategories); one file can be shown or hidden on its
 * own (File.crewVisible: true / false; null follows the kind). What a crew
 * lead uploaded is always theirs to see.
 */
export const DEFAULT_CREW_FILE_CATEGORIES: readonly FileCategory[] = ["PLAN_SET", "PHOTOS", "VIDEO", "PERMIT", "INSPECTION"];

/** Never shown to a crew by kind, whatever the setting says; a single file can still be shown on purpose. */
export const NEVER_CREW_BY_KIND: readonly FileCategory[] = ["CUSTOMER_CONTRACT", "ESTIMATE", "LABOR_CONTRACT", "INTERIOR_RENOVATION_LABOR_CONTRACT", "CONTRACT_ADDENDUM", "SIGNED_DOC", "RECEIPT", "INSURANCE"];

/** The setting with the always-private kinds taken out. No setting yet = the defaults; an empty one = none by kind. */
export function allowedCrewCategories(setting: readonly FileCategory[] | null | undefined): FileCategory[] {
  const list = setting ?? DEFAULT_CREW_FILE_CATEGORIES;
  return [...new Set(list)].filter((c) => !NEVER_CREW_BY_KIND.includes(c));
}

/** The File filter a crew lead's reads are ANDed with. */
export function crewFileWhere(viewerId: string, categories: readonly FileCategory[]): Prisma.FileWhereInput {
  return {
    OR: [
      { uploadedByUserId: viewerId },
      { crewVisible: true },
      { AND: [{ category: { in: [...categories] } }, { OR: [{ crewVisible: null }, { crewVisible: true }] }] },
    ],
  };
}

export async function crewFileCategories(): Promise<FileCategory[]> {
  const s = await prisma.laborSettings.findFirst({ select: { crewFileCategories: true } });
  return allowedCrewCategories(s?.crewFileCategories);
}

/**
 * `fileReadWhere` plus, for a crew lead, the crew rule above. Server-only (it
 * reads the setting), so file routes call this rather than `fileReadWhere`.
 */
export async function fileReadWhereFor(viewer: { id: string; role: RoleName }): Promise<Prisma.FileWhereInput> {
  const base = fileReadWhere(viewer);
  if (viewer.role !== "CREW_LEAD") return base;
  return { AND: [base, crewFileWhere(viewer.id, await crewFileCategories())] };
}

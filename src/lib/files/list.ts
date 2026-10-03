import type { Prisma } from "@/generated/prisma/client";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { fileExists } from "./storage";

/** What every file list loads: who uploaded it, the job and task it sits on, and whether the CRM generated it. */
export const FILE_LIST_INCLUDE = {
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
  job: { select: JOB_LABEL_SELECT },
  task: { select: { id: true, title: true } },
  // A receipt says which expense it is for.
  expense: { select: { id: true, vendor: true, amount: true, incurredDate: true } },
  _count: { select: { generatedDocuments: true } },
} satisfies Prisma.FileInclude;

type Row = Prisma.FileGetPayload<{ include: typeof FILE_LIST_INCLUDE }>;

/**
 * A file as the screens see it: `missing` (its data is gone from the store —
 * shown, never hidden, so it can be uploaded again) and `generated` (a
 * contract or signed PDF the CRM wrote; it cannot be deleted or replaced).
 * The storage key never leaves the server.
 */
export async function presentFiles(rows: readonly Row[]) {
  const present = await Promise.all(rows.map((r) => fileExists(r.storageKey)));
  return rows.map((r, i) => {
    const { storageKey: _key, _count, ...rest } = r;
    void _key;
    return { ...rest, expense: rest.expense ? { ...rest.expense, amount: Number(rest.expense.amount) } : null, missing: !present[i], generated: _count.generatedDocuments > 0 };
  });
}

export type PresentedFile = Awaited<ReturnType<typeof presentFiles>>[number];

import type { Prisma } from "@/generated/prisma/client";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { permitLockOf } from "./access";
import { fileExists } from "./storage";

/** What every file list loads: who uploaded it, the job and task it sits on, and whether the CRM generated it. */
export const FILE_LIST_INCLUDE = {
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
  job: { select: JOB_LABEL_SELECT },
  task: { select: { id: true, title: true } },
  // A receipt says which expense it is for.
  expense: { select: { id: true, vendor: true, amount: true, incurredDate: true } },
  _count: { select: { generatedDocuments: true, permitSubmissions: true } },
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
    // the storage key never leaves the server; the extracted text is the library's, and can be a whole plan set
    const { storageKey: _key, extractedText: _text, _count, ...rest } = r;
    void _key;
    void _text;
    return {
      ...rest,
      expense: rest.expense ? { ...rest.expense, amount: Number(rest.expense.amount) } : null,
      missing: !present[i],
      generated: _count.generatedDocuments > 0,
      // a permit document sent in a frozen package, or issued by the department: kept as it is
      permitLock: permitLockOf({ permitDocType: rest.permitDocType, permitSubmissionCount: _count.permitSubmissions }),
    };
  });
}

export type PresentedFile = Awaited<ReturnType<typeof presentFiles>>[number];

/** Completion photos as a request or payment row carries them. */
export const PHOTO_SELECT = {
  id: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  storageKey: true,
  takenAt: true,
  createdAt: true,
} satisfies Prisma.FileSelect;

type PhotoRow = Prisma.FileGetPayload<{ select: typeof PHOTO_SELECT }>;

/** Photos for a screen: `missing` added, the storage key kept on the server. */
export async function presentPhotos(rows: readonly PhotoRow[]) {
  const present = await Promise.all(rows.map((r) => fileExists(r.storageKey)));
  return rows.map((r, i) => {
    const { storageKey: _key, ...rest } = r;
    void _key;
    return { ...rest, missing: !present[i] };
  });
}

/** Give each record its photos in presented form, keeping everything else. */
export async function withPresentedPhotos<T extends { photos: PhotoRow[] }>(rows: readonly T[]) {
  return Promise.all(rows.map(async (r) => ({ ...r, photos: await presentPhotos(r.photos) })));
}

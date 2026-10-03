/**
 * How files are named, grouped and recognised on screen. Pure and client-safe.
 *
 * A file belongs to a job when it has a `jobId`. A lead's file with none is a
 * lead document — an estimate, something uploaded before the job existed — and
 * is shown on a job in a group of its own, never mixed into the job's files.
 */

export type FileCategoryName =
  | "PHOTOS"
  | "ESTIMATE"
  | "PERMIT"
  | "SIGNED_DOC"
  | "INSURANCE"
  | "INSPECTION"
  | "LABOR_CONTRACT"
  | "INTERIOR_RENOVATION_LABOR_CONTRACT"
  | "CONTRACT_ADDENDUM"
  | "CUSTOMER_CONTRACT"
  | "RECEIPT"
  | "OTHER";

export const CATEGORY_LABEL: Record<FileCategoryName, string> = {
  CUSTOMER_CONTRACT: "Customer contract",
  SIGNED_DOC: "Signed documents",
  ESTIMATE: "Estimates",
  PERMIT: "Permits",
  INSPECTION: "Inspections",
  INSURANCE: "Insurance",
  LABOR_CONTRACT: "Labor contracts",
  INTERIOR_RENOVATION_LABOR_CONTRACT: "Interior renovation labor contracts",
  CONTRACT_ADDENDUM: "Contract addenda",
  RECEIPT: "Receipts",
  PHOTOS: "Photos",
  OTHER: "Other",
};

/** The order groups appear in: the agreement first, loose files last. */
export const CATEGORY_ORDER: readonly FileCategoryName[] = [
  "CUSTOMER_CONTRACT",
  "SIGNED_DOC",
  "ESTIMATE",
  "PERMIT",
  "INSPECTION",
  "INSURANCE",
  "LABOR_CONTRACT",
  "INTERIOR_RENOVATION_LABOR_CONTRACT",
  "CONTRACT_ADDENDUM",
  "RECEIPT",
  "PHOTOS",
  "OTHER",
];

/** What a person may pick when uploading or recategorising. The rest are written by the CRM. */
export const UPLOAD_CATEGORIES: readonly FileCategoryName[] = ["PHOTOS", "ESTIMATE", "PERMIT", "SIGNED_DOC", "INSURANCE", "INSPECTION", "OTHER"];

export const categoryLabel = (c: string) => CATEGORY_LABEL[c as FileCategoryName] ?? c.toLowerCase().replace(/_/g, " ");

export type PreviewKind = "image" | "pdf" | "other";

/** What the preview can show in place. HEIC is an image the browser cannot draw. */
export function previewKind(fileType: string | null | undefined): PreviewKind {
  const t = (fileType ?? "").toLowerCase();
  if (t === "application/pdf") return "pdf";
  if (t.startsWith("image/") && !t.includes("heic") && !t.includes("heif")) return "image";
  return "other";
}

export const isImageType = (fileType: string | null | undefined) => (fileType ?? "").toLowerCase().startsWith("image/");

export type FilterableFile = { fileName: string; category: string; missing?: boolean };

export type FileFilter = { category?: string | null; q?: string | null; missingOnly?: boolean };

export function filterFiles<F extends FilterableFile>(files: readonly F[], f: FileFilter): F[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return files.filter((x) => (!f.category || x.category === f.category) && (!f.missingOnly || x.missing) && (!q || x.fileName.toLowerCase().includes(q)));
}

/** Files in category groups, in `CATEGORY_ORDER`; empty groups are left out. */
export function groupByCategory<F extends { category: string }>(files: readonly F[]): { category: string; label: string; files: F[] }[] {
  const by = new Map<string, F[]>();
  for (const f of files) by.set(f.category, [...(by.get(f.category) ?? []), f]);
  const known = CATEGORY_ORDER.filter((c) => by.has(c)) as string[];
  const unknown = [...by.keys()].filter((c) => !known.includes(c)).sort();
  return [...known, ...unknown].map((c) => ({ category: c, label: categoryLabel(c), files: by.get(c) as F[] }));
}

/** How many files there are of each category, for the filter chips. */
export function categoryCounts(files: readonly { category: string }[]): { category: string; label: string; count: number }[] {
  return groupByCategory(files).map((g) => ({ category: g.category, label: g.label, count: g.files.length }));
}

/** A file name a person typed: trimmed, the original extension kept when they dropped it. */
export function cleanFileName(input: string, original: string): string | null {
  const name = input.trim().replace(/[\\/\u0000-\u001f]/g, "");
  if (!name) return null;
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(original)?.[0] ?? "";
  return ext && !/\.[A-Za-z0-9]{1,10}$/.test(name) ? `${name}${ext}`.slice(0, 200) : name.slice(0, 200);
}

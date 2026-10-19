import { entryName } from "@/lib/partners/package-plan";
import { permitDocLabel } from "./doc-types";

/**
 * What a submission is and what goes in it. Pure: `submissions.ts` loads the
 * rows, freezes the package and writes the cycle.
 *
 * A permit is reviewed in cycles: each submission opens one and the building
 * department's answer closes it. A cycle waiting on its answer takes no second
 * submission — the answer is recorded first.
 */
export type CycleRow = { id: string; number: number; outcome: "PENDING" | "APPROVED" | "CORRECTIONS" | "DENIED" | "WITHDRAWN"; hasSubmission: boolean };

export type NextCycle =
  | { ok: true; number: number; kind: "INITIAL" | "RESUBMISSION" | "REVISION"; reuseCycleId: string | null }
  | { ok: false; reason: string };

export function nextCycle(cycles: CycleRow[]): NextCycle {
  const latest = [...cycles].sort((a, b) => b.number - a.number)[0];
  if (!latest) return { ok: true, number: 1, kind: "INITIAL", reuseCycleId: null };
  if (latest.outcome === "PENDING") {
    if (latest.hasSubmission) return { ok: false, reason: `Cycle ${latest.number} is still waiting on the building department. Record its outcome before submitting again.` };
    // a cycle recorded by hand (a submission made before packages existed) takes this package
    return { ok: true, number: latest.number, kind: latest.number === 1 ? "INITIAL" : "RESUBMISSION", reuseCycleId: latest.id };
  }
  const kind = latest.outcome === "APPROVED" ? "REVISION" : "RESUBMISSION";
  return { ok: true, number: latest.number + 1, kind, reuseCycleId: null };
}

/** The permit's status once the department has answered a cycle; null leaves it as it is. */
export function statusForOutcome(outcome: CycleRow["outcome"]): "ISSUED" | "CORRECTIONS" | "DENIED" | "PREPARING" | null {
  switch (outcome) {
    case "APPROVED":
      return "ISSUED";
    case "CORRECTIONS":
      return "CORRECTIONS";
    case "DENIED":
      return "DENIED";
    case "WITHDRAWN":
      return "PREPARING";
    default:
      return null;
  }
}

export type PackageFile = { id: string; fileName: string; permitDocType: string | null; fileSize: number; missing: boolean };
export type ManifestEntry = { fileId: string; name: string; docType: string | null; bytes: number; entry: string };

/**
 * The zip's entries in a stable order (by document type, then name), each
 * named "01 - Notice of commencement - noc.pdf". A file missing from the
 * store cannot be sent: the plan says which.
 */
export function planManifest(files: PackageFile[]): { entries: ManifestEntry[]; missing: PackageFile[] } {
  const missing = files.filter((f) => f.missing);
  const present = files
    .filter((f) => !f.missing)
    .sort((a, b) => permitDocLabel(a.permitDocType).localeCompare(permitDocLabel(b.permitDocType)) || a.fileName.localeCompare(b.fileName));
  const entries = present.map((f, i) => ({ fileId: f.id, name: f.fileName, docType: f.permitDocType, bytes: f.fileSize, entry: entryName(i + 1, permitDocLabel(f.permitDocType), f.fileName) }));
  return { entries, missing };
}

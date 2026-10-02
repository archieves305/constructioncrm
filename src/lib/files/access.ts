import type { FileCategory, Prisma, RoleName } from "@/generated/prisma/client";
import { jobsInvolvingUserWhere, leadsInvolvingUserWhere } from "@/lib/jobs/involvement";

/**
 * Who may open or delete a stored file.
 *
 * `GET` and `DELETE /api/files/[id]` used to check only that someone was
 * signed in: anyone with a file's id could read or permanently delete it,
 * signed contracts included, with no trace.
 */
type Viewer = { id: string; role: RoleName };

/** Roles that work one customer or job at a time; everyone else reads every file. */
const OWN_ONLY: readonly RoleName[] = ["SALES_REP", "CREW_LEAD"];

const OFFICE: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

/**
 * Files this viewer may read, as a filter to AND into any File query. An
 * own-only role reads what it uploaded, files on a lead it is involved with
 * (assigned, or the customer of one of its jobs), files on a task it owns,
 * raised, or that sits on one of its jobs, and files on a violation case it
 * manages or holds a team slot on.
 */
export function fileReadWhere(viewer: Viewer): Prisma.FileWhereInput {
  if (!OWN_ONLY.includes(viewer.role)) return {};
  return {
    OR: [
      { uploadedByUserId: viewer.id },
      { lead: leadsInvolvingUserWhere(viewer.id) },
      {
        task: {
          OR: [
            { assignedUserId: viewer.id },
            { createdByUserId: viewer.id },
            { job: jobsInvolvingUserWhere(viewer.id) },
          ],
        },
      },
      { violationCase: { OR: [{ caseManagerId: viewer.id }, { workflow: { team: { some: { userId: viewer.id } } } }] } },
    ],
  };
}

/**
 * Categories no one deletes through the file route. A customer contract's PDF
 * is the contract; the contract service owns its lifecycle.
 */
const PROTECTED: readonly FileCategory[] = ["CUSTOMER_CONTRACT"];

export type DeleteVerdict = { ok: true } | { ok: false; reason: string };

/** Office roles delete any ordinary file; anyone else only what they uploaded; READ_ONLY nothing. */
export function canDeleteFile(viewer: Viewer, file: { category: FileCategory; uploadedByUserId: string }): DeleteVerdict {
  if (PROTECTED.includes(file.category)) {
    return { ok: false, reason: "Contract documents cannot be deleted. Void the contract instead." };
  }
  if (viewer.role === "READ_ONLY") return { ok: false, reason: "Read-only users cannot delete files." };
  if (OFFICE.includes(viewer.role)) return { ok: true };
  if (file.uploadedByUserId === viewer.id) return { ok: true };
  return { ok: false, reason: "You can only delete files you uploaded. Ask the office to remove this one." };
}

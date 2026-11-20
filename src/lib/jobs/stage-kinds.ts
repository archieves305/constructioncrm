/**
 * Two kinds of job, two stage lists (Richard, 2026-11-20).
 *
 * A client job is sold work: it has a deposit, a contract and a final
 * payment, and its stages say so. Our own projects (jobType OWNED_REHAB) are
 * flips and rentals: there is nobody to bill, so they skip the money stages
 * and end at a sale or a lease instead. Every `JobStage` row lists the kinds
 * it serves (`kinds`); a job only ever stands in a stage of its own kind.
 * Pure: no Prisma.
 */
export type JobKind = "CLIENT" | "FLIP" | "RENTAL";
export type OwnedPurpose = "FLIP" | "RENTAL";

export const JOB_KINDS: readonly JobKind[] = ["CLIENT", "FLIP", "RENTAL"];

export const JOB_KIND_LABEL: Record<JobKind, string> = {
  CLIENT: "Client job",
  FLIP: "Flip",
  RENTAL: "Rental",
};

/** The kind a job's stages come from. An owned job with no purpose yet is treated as a flip. */
export function jobKindOf(job: { jobType: string; ownedPurpose?: string | null }): JobKind {
  if (job.jobType !== "OWNED_REHAB") return "CLIENT";
  return job.ownedPurpose === "RENTAL" ? "RENTAL" : "FLIP";
}

export function isOwnedKind(kind: JobKind): kind is OwnedPurpose {
  return kind !== "CLIENT";
}

/** The stage a new job of this kind starts in. */
export const START_STAGE: Record<JobKind, string> = {
  CLIENT: "Won",
  FLIP: "Planning",
  RENTAL: "Planning",
};

/** Where an owned project lands when its rehab is closed out: ready to sell or let. */
export const REHAB_DONE_STAGE: Record<OwnedPurpose, string> = {
  FLIP: "Listed",
  RENTAL: "Ready to Rent",
};

type StageSeed = { name: string; stageOrder: number; isClosed?: boolean; kinds: readonly JobKind[] };

const ALL: readonly JobKind[] = JOB_KINDS;
const OWNED: readonly JobKind[] = ["FLIP", "RENTAL"];
const BOTH: readonly JobKind[] = ["CLIENT", "FLIP", "RENTAL"];

/**
 * The seeded stages. Orders are compared only within one kind, so a flip's
 * "Listed" may share a number with a client's "Final Payment Due". Closed
 * sits after everything and serves every kind.
 */
export const STAGE_SEED: readonly StageSeed[] = [
  { name: "Won", stageOrder: 1, kinds: ["CLIENT"] },
  { name: "Planning", stageOrder: 1, kinds: OWNED },
  { name: "Deposit Needed", stageOrder: 2, kinds: ["CLIENT"] },
  { name: "Financing Cleared", stageOrder: 3, kinds: ["CLIENT"] },
  { name: "Measure Complete", stageOrder: 4, kinds: ["CLIENT"] },
  { name: "Scope Finalized", stageOrder: 5, kinds: BOTH },
  { name: "Permit Submitted", stageOrder: 6, kinds: BOTH },
  { name: "Permit Corrections", stageOrder: 7, kinds: BOTH },
  { name: "Permit Approved", stageOrder: 8, kinds: BOTH },
  { name: "Materials Ordered", stageOrder: 9, kinds: BOTH },
  { name: "Scheduled", stageOrder: 10, kinds: BOTH },
  { name: "In Progress", stageOrder: 11, kinds: BOTH },
  { name: "Punch List", stageOrder: 12, kinds: BOTH },
  { name: "Final Inspection", stageOrder: 13, kinds: BOTH },
  { name: "Final Payment Due", stageOrder: 14, kinds: ["CLIENT"] },
  { name: "Listed", stageOrder: 14, kinds: ["FLIP"] },
  { name: "Under Contract", stageOrder: 15, kinds: ["FLIP"] },
  { name: "Sold", stageOrder: 16, isClosed: true, kinds: ["FLIP"] },
  { name: "Ready to Rent", stageOrder: 14, kinds: ["RENTAL"] },
  { name: "Leased", stageOrder: 15, isClosed: true, kinds: ["RENTAL"] },
  { name: "Closed", stageOrder: 20, isClosed: true, kinds: ALL },
];

export type StageLike = { id: string; name: string; stageOrder: number; kinds: readonly string[] };

/** The stages a job of this kind may stand in, in order. */
export function stagesFor<S extends StageLike>(stages: readonly S[], kind: JobKind): S[] {
  return stages.filter((s) => s.kinds.includes(kind)).sort((a, b) => a.stageOrder - b.stageOrder);
}

/** What the Jobs board and list show: client work, or our own projects (both kinds, or one). */
export type JobView = "CLIENT" | "OWNED" | "FLIP" | "RENTAL";
export const JOB_VIEWS: readonly JobView[] = ["CLIENT", "OWNED", "FLIP", "RENTAL"];

export function parseJobView(v: string | null | undefined): JobView | undefined {
  return v && (JOB_VIEWS as readonly string[]).includes(v) ? (v as JobView) : undefined;
}

/**
 * The board's columns for a view. "Our projects" shows both lists at once:
 * the stages they share, then a flip's ending, then a rental's, Closed last.
 */
export function stagesForView<S extends StageLike>(stages: readonly S[], view: JobView): S[] {
  if (view !== "OWNED") return stagesFor(stages, view);
  const rank = (s: S) => (s.name === "Closed" ? 3 : s.kinds.includes("FLIP") && s.kinds.includes("RENTAL") ? 0 : s.kinds.includes("FLIP") ? 1 : 2);
  return stages
    .filter((s) => s.kinds.includes("FLIP") || s.kinds.includes("RENTAL"))
    .sort((a, b) => rank(a) - rank(b) || a.stageOrder - b.stageOrder);
}

export function stageFitsKind(stage: { kinds: readonly string[] }, kind: JobKind): boolean {
  return stage.kinds.includes(kind);
}

/**
 * The stage a job moves to when its kind changes: the stage of the same name
 * when the new kind has it, else the nearest earlier stage of the new kind,
 * else its first stage.
 */
export function mapStageToKind<S extends StageLike>(stages: readonly S[], current: { name: string; stageOrder: number }, kind: JobKind): S | null {
  const list = stagesFor(stages, kind);
  if (list.length === 0) return null;
  const same = list.find((s) => s.name === current.name);
  if (same) return same;
  const open = list.filter((s) => s.name !== "Closed");
  const earlier = open.filter((s) => s.stageOrder <= current.stageOrder);
  return earlier.at(-1) ?? open[0] ?? list[0]!;
}

/** What the job's next action reads when it reaches a stage. */
export const NEXT_ACTION: Record<string, string> = {
  Won: "Collect deposit",
  "Deposit Needed": "Collect deposit",
  "Financing Cleared": "Schedule measurement",
  "Measure Complete": "Finalize scope",
  "Scope Finalized": "Submit permit",
  "Permit Submitted": "Follow up on permit",
  "Permit Corrections": "Resolve permit corrections",
  "Permit Approved": "Order materials",
  "Materials Ordered": "Schedule installation",
  Scheduled: "Confirm crew and date",
  "In Progress": "Monitor progress",
  "Punch List": "Complete punch list items",
  "Final Inspection": "Schedule inspection",
  "Final Payment Due": "Collect final payment",
  Planning: "Set the budget and scope",
  Listed: "Market the property",
  "Under Contract": "Prepare for closing",
  "Ready to Rent": "Find a tenant",
  Sold: "",
  Leased: "",
  Closed: "",
};

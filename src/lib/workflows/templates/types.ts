import type {
  Priority,
  TaskDependencyKind,
  WorkflowAnchor,
  WorkflowEvidenceType,
  WorkflowPermitCondition,
  WorkflowRole,
  WorkflowTemplateKind,
} from "@/generated/prisma/client";

/**
 * The authoring DSL for workflow templates.
 *
 * A `TemplateSpec` is what a seed file exports: readable, terse, with a few
 * conveniences (`^`, `startsAfter`, phase-level permit branches) that
 * `defineTemplate` expands into the flat, fully explicit `TemplateDefinition`
 * the database and the compose engine work from. The definition shape is the
 * same one the Stage 2 editor round-trips, so seeded and hand-built templates
 * are indistinguishable downstream.
 */

/** "task_key" in the same template, "^" = the previous task in this phase, or "core:task_key". */
export type DependencyRef = string;

export type TaskCondition = {
  /** Only when the job's permit status matches. */
  permit?: WorkflowPermitCondition;
  /** At least one of these scope toggles is on. */
  anyOf?: string[];
  /** All of these scope toggles are on. */
  allOf?: string[];
};

export type ChecklistItemSpec = string | { text: string; condition?: TaskCondition };

export type TaskSpec = {
  key: string;
  title: string;
  description?: string;
  role: WorkflowRole;
  priority?: Priority;
  /** Defaults to PREDECESSOR when the task has dependencies, else JOB_CREATED. */
  anchor?: WorkflowAnchor;
  /** Business days from the anchor to the due date. Default 2. Negative only with TARGET_START. */
  dueOffsetBusinessDays?: number;
  durationBusinessDays?: number;
  dependsOn?: DependencyRef[];
  /** Predecessors that only feed the due date and never hold the task back. */
  dependsOnDateOnly?: DependencyRef[];
  /** Set false to make a dependency-free task wait for someone to start it. Default true. */
  autoActivate?: boolean;
  blocking?: boolean;
  requiredEvidence?: WorkflowEvidenceType;
  requiredEvidenceParam?: string;
  checklist?: ChecklistItemSpec[];
  condition?: TaskCondition;
  /** A trade task that replaces a Core task with the same meaning. TRADE only. */
  overridesCoreKey?: string;
};

export type PhaseSpec = {
  key: string;
  name: string;
  /** Ordering band shared across modules; see PHASE_BANDS. */
  band: number;
  description?: string;
  /** Shown under the phase heading. Required on a NOT_REQUIRED permit phase (the legal warning). */
  note?: string;
  /** Every task in this phase inherits this permit condition. */
  permit?: WorkflowPermitCondition;
  /**
   * Blocking predecessors for every task in the phase that has no in-phase
   * dependency of its own — how a trade's Scope Review waits for Core's
   * contract review without repeating the ref on each task.
   */
  startsAfter?: DependencyRef[];
  tasks: TaskSpec[];
};

export type ScopeToggleSpec = {
  key: string;
  label: string;
  description?: string;
  default: boolean;
};

export type TemplateSpec = {
  key: string;
  name: string;
  kind: WorkflowTemplateKind;
  trade?: string;
  description?: string;
  /** Lead service categories (by name) that suggest this template. */
  serviceCategoryNames?: string[];
  scopeToggles?: ScopeToggleSpec[];
  phases: PhaseSpec[];
};

/** Shared ordering bands so Core and trade phases interleave sensibly. */
export const PHASE_BANDS = {
  JOB_SETUP: 100,
  PRECONSTRUCTION: 200,
  SCOPE_REVIEW: 300,
  PERMITTING: 400,
  PROCUREMENT: 500,
  PRODUCTION_READINESS: 600,
  CORE_PRODUCTION: 700,
  INSTALLATION: 800,
  TRADE_CLOSEOUT: 900,
  CORE_CLOSEOUT: 1000,
} as const;

export const LEGAL_NO_PERMIT_WARNING =
  'Select "No Permit Required" only after confirming that the project is legally exempt or that no permit is required by the applicable jurisdiction.';

// ── Normalised output ────────────────────────────────────────────────────────

export type ChecklistItemDef = { key: string; label: string; condition: TaskCondition | null };

export type PhaseDef = {
  key: string;
  name: string;
  band: number;
  sortOrder: number;
  description: string | null;
  note: string | null;
  conditionPermit: WorkflowPermitCondition | null;
};

export type TaskDef = {
  key: string;
  phaseKey: string;
  title: string;
  description: string | null;
  role: WorkflowRole;
  priority: Priority;
  anchor: WorkflowAnchor;
  dueOffsetBusinessDays: number;
  durationBusinessDays: number | null;
  autoActivate: boolean;
  blocking: boolean;
  requiredEvidence: WorkflowEvidenceType | null;
  requiredEvidenceParam: string | null;
  checklist: ChecklistItemDef[];
  conditionPermit: WorkflowPermitCondition | null;
  conditionAnyOf: string[];
  conditionAllOf: string[];
  overridesCoreKey: string | null;
  sortOrder: number;
};

export type DependencyDef = {
  taskKey: string;
  /** "task_key" (same template) or "core:task_key". `^` is already expanded. */
  dependsOnRef: string;
  kind: TaskDependencyKind;
};

export type TemplateDefinition = {
  key: string;
  name: string;
  kind: WorkflowTemplateKind;
  trade: string | null;
  description: string | null;
  serviceCategoryNames: string[];
  scopeToggles: ScopeToggleSpec[];
  phases: PhaseDef[];
  tasks: TaskDef[];
  dependencies: DependencyDef[];
};

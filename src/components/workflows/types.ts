import type {
  JobWorkflowStatus,
  Priority,
  TaskDependencyKind,
  TaskStatus,
  WorkflowAnchor,
  WorkflowEvidenceType,
  WorkflowPermitCondition,
  WorkflowPermitStatus,
  WorkflowRole,
  WorkflowTemplateKind,
} from "@/generated/prisma/client";
import type { LeadLabel, Person, TaskListItem } from "@/components/tasks/types";
import { caseLabel } from "@/lib/labels/case";
import { jobLabel } from "@/lib/labels/job";
import type { PhaseProgress } from "@/lib/workflows/read";

export type { WorkflowRole, WorkflowPermitStatus, PhaseProgress };

export type ChecklistItem = { key: string; label: string; done: boolean; doneAt?: string | null; doneByUserId?: string | null };

export type WorkflowDependency = {
  kind: TaskDependencyKind;
  source: string;
  dependsOnTaskId: string;
  dependsOn: { id: string; title: string; status: TaskStatus; workflowTaskKey: string | null; activatedAt: string | null };
};

/** A task row as the Workflow tab receives it: the list row plus the workflow columns. */
export type WorkflowTaskItem = TaskListItem & {
  assignedUserId: string | null;
  createdByUserId: string;
  workflowInstanceId: string | null;
  workflowTaskKey: string | null;
  workflowPhaseKey: string | null;
  workflowModuleKey: string | null;
  workflowRole: WorkflowRole | null;
  workflowSortOrder: number | null;
  workflowAnchor: WorkflowAnchor | null;
  dueOffsetBusinessDays: number | null;
  blocking: boolean;
  activatedAt: string | null;
  dueLocked: boolean;
  skipReason: string | null;
  requiredEvidence: WorkflowEvidenceType | null;
  requiredEvidenceParam: string | null;
  checklist: ChecklistItem[] | null;
  inspectionResult: "SCHEDULED" | "PASS" | "FAIL" | "CONDITIONAL" | "CANCELLED" | null;
  inspectionRecordedAt: string | null;
  dependencies: WorkflowDependency[];
  _count?: { events: number; files?: number; dependents?: number };
};

export type WorkflowPhaseItem = {
  key: string;
  moduleKey: string;
  moduleName: string;
  shortKey: string;
  name: string;
  band: number;
  note: string | null;
  description: string | null;
  conditionPermit: WorkflowPermitCondition | null;
  sortOrder: number;
  progress: PhaseProgress;
  taskIds: string[];
};

export type ScopeToggleDef = { key: string; label: string; description?: string; default: boolean };

/** The record a workflow runs on. A string is a job id (the older form). */
export type WorkflowSubjectRef = { kind: "job" | "violation"; id: string };
export type SubjectLike = string | WorkflowSubjectRef;

export function toSubjectRef(s: SubjectLike): WorkflowSubjectRef {
  return typeof s === "string" ? { kind: "job", id: s } : s;
}

/** The subject a task belongs to, from its links: a violation case first (its tasks never carry a job). */
export function subjectOfTask(task: { job?: { id: string } | null; violationCase?: { id: string } | null }): WorkflowSubjectRef | null {
  if (task.violationCase) return { kind: "violation", id: task.violationCase.id };
  if (task.job) return { kind: "job", id: task.job.id };
  return null;
}

export function subjectHref(ref: WorkflowSubjectRef): string {
  return ref.kind === "job" ? `/jobs/${ref.id}` : `/violations/${ref.id}`;
}

/** What the tab and its dialogs need from the subject, whichever kind it is. */
export type WorkflowSubjectInfo = {
  kind: "job" | "violation";
  id: string;
  leadId: string;
  /** Address-led display name; falls back to the title, then the number. */
  label: string;
  /** "JOB-00012" / "CV-00003" */
  code: string;
  title: string;
  href: string;
  jurisdiction: string | null;
  targetStartDate: string | null;
  projectManagerId: string | null;
  salesRepId: string | null;
  caseManagerId: string | null;
};

export function subjectInfoOf(data: JobWorkflowData): WorkflowSubjectInfo {
  if (data.case) {
    const c = data.case;
    return { kind: "violation", id: c.id, leadId: c.leadId, label: caseLabel(c).primary, code: c.caseNumber, title: c.title, href: `/violations/${c.id}`, jurisdiction: c.jurisdiction, targetStartDate: null, projectManagerId: null, salesRepId: null, caseManagerId: c.caseManagerId };
  }
  const j = data.job!;
  return { kind: "job", id: j.id, leadId: j.leadId, label: jobLabel(j).primary, code: j.jobNumber, title: j.title, href: `/jobs/${j.id}`, jurisdiction: j.jurisdiction, targetStartDate: j.targetStartDate, projectManagerId: j.projectManagerId, salesRepId: j.salesRepId, caseManagerId: null };
}

export type JobWorkflowData = {
  job?: {
    id: string;
    leadId: string;
    jobNumber: string;
    title: string;
    serviceType: string;
    projectManagerId: string | null;
    salesRepId: string | null;
    targetStartDate: string | null;
    jurisdiction: string | null;
    createdAt: string;
    lead?: LeadLabel | null;
  };
  case?: {
    id: string;
    leadId: string;
    jobId: string | null;
    caseNumber: string;
    title: string;
    jurisdiction: string | null;
    caseManagerId: string | null;
    currentDeadline: string | null;
    nextHearingAt: string | null;
    createdAt: string;
    lead?: LeadLabel | null;
  };
  permissions: { canApply: boolean; canSetPermit: boolean; canCoordinate: boolean; canOverrideGate: boolean };
  instance: {
    id: string;
    status: JobWorkflowStatus;
    permitStatus: WorkflowPermitStatus;
    permitDeterminedAt: string | null;
    permitDeterminedBy: Person | null;
    permitNotes: string | null;
    permitDocumentFileId: string | null;
    scopeToggles: Record<string, Record<string, boolean>>;
    appliedAt: string;
    appliedBy: Person;
    lastReconciledAt: string | null;
  } | null;
  modules?: { templateKey: string; name: string; kind: WorkflowTemplateKind; trade: string | null; version: number; versionId: string; removedAt: string | null }[];
  team?: { role: WorkflowRole; user: Person }[];
  toggles?: { moduleKey: string; name: string; toggles: ScopeToggleDef[]; values: Record<string, boolean> }[];
  phases?: WorkflowPhaseItem[];
  tasks?: WorkflowTaskItem[];
  progress?: PhaseProgress;
  unassignedRoles?: WorkflowRole[];
  upgrades?: { templateKey: string; from: number; to: number; versionId: string }[];
};

// ── Stage 2 ──

export type ReconcileChange =
  | { kind: "permit"; status: "REQUIRED" | "NOT_REQUIRED"; reason?: string | null; notes?: string | null; documentFileId?: string | null; jurisdiction?: string | null }
  | { kind: "add-module"; templateKeys: string[]; scopeToggles?: Record<string, Record<string, boolean>> }
  | { kind: "remove-module"; templateKey: string; reason: string; retainTaskIds?: string[] }
  | { kind: "scope"; scopeToggles: Record<string, Record<string, boolean>> }
  | { kind: "upgrade-module"; templateKey: string; versionId?: string };

export type ReconcileItem = { id: string | null; key: string; title: string; moduleKey: string; phaseKey: string | null; status: TaskStatus | null; blocking: boolean };

export type ReconcilePlanData = {
  change: ReconcileChange;
  label: string;
  permitStatus: WorkflowPermitStatus;
  modules: { moduleKey: string; name: string; version: number }[];
  toCreate: ReconcileItem[];
  toReinstate: ReconcileItem[];
  toSkip: ReconcileItem[];
  preserved: (ReconcileItem & { why: "completed" | "manual" | "retained" | "correction" | "user-skipped" })[];
  edgesToAdd: number;
  edgesToRemove: number;
  drift: { key: string; field: "title" | "description"; from: string | null; to: string | null }[];
  warnings: string[];
};

export type ReconcileResultData = { plan: ReconcilePlanData; created: number; reinstated: number; skipped: number; activated: number };

export type InspectionBody = { result: "PASS" | "FAIL" | "CONDITIONAL"; notes?: string | null; inspectedAt?: string; jobPermitInspectionId?: string | null; violationInspectionId?: string | null };

export type VersionStatus = "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";

export type AdminVersionSummary = {
  id: string;
  version: number;
  status: VersionStatus;
  publishedAt: string | null;
  supersededAt?: string | null;
  changeNotes: string | null;
  createdAt?: string;
  _count: { phases: number; tasks: number; modules: number };
};

export type AdminTemplate = {
  id: string;
  key: string;
  name: string;
  kind: WorkflowTemplateKind;
  trade: string | null;
  description: string | null;
  isActive: boolean;
  serviceCategories: { id: string; name: string }[];
  versions: AdminVersionSummary[];
};

export type EditorPhase = {
  id: string;
  key: string;
  name: string;
  band: number;
  sortOrder: number;
  description: string | null;
  note: string | null;
  conditionPermit: WorkflowPermitCondition | null;
};

export type EditorChecklistItem = { key?: string; label: string; condition?: { anyOf?: string[]; allOf?: string[] } | null };

export type EditorTask = {
  id: string;
  phaseId: string;
  key: string;
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
  checklist: EditorChecklistItem[];
  conditionPermit: WorkflowPermitCondition | null;
  conditionAnyOf: string[];
  conditionAllOf: string[];
  overridesCoreKey: string | null;
  sortOrder: number;
};

export type EditorDependency = { id: string; taskKey: string; dependsOnRef: string; kind: TaskDependencyKind };

export type EditorVersion = {
  id: string;
  version: number;
  status: VersionStatus;
  changeNotes: string | null;
  publishedAt: string | null;
  template: { id: string; key: string; name: string; kind: WorkflowTemplateKind; trade: string | null; description: string | null };
  scopeToggles: ScopeToggleDef[];
  phases: EditorPhase[];
  tasks: EditorTask[];
  dependencies: EditorDependency[];
  referencedByJobs: number;
  coreSteps: { key: string; title: string }[];
};

export type ValidationIssue = { level: "error" | "warning"; message: string; phaseKey?: string; taskKey?: string };
export type ValidationResultData = { ok: boolean; issues: ValidationIssue[] };

export type TaskTemplateInput = {
  phaseId: string;
  key?: string;
  title: string;
  description?: string | null;
  role: WorkflowRole;
  priority?: Priority;
  anchor?: WorkflowAnchor;
  dueOffsetBusinessDays?: number;
  durationBusinessDays?: number | null;
  autoActivate?: boolean;
  blocking?: boolean;
  requiredEvidence?: WorkflowEvidenceType | null;
  requiredEvidenceParam?: string | null;
  checklist?: EditorChecklistItem[];
  conditionPermit?: WorkflowPermitCondition | null;
  conditionAnyOf?: string[];
  conditionAllOf?: string[];
  overridesCoreKey?: string | null;
  dependsOn?: { ref: string; kind?: TaskDependencyKind }[];
};

export type PhaseInput = { key?: string; name: string; band: number; description?: string | null; note?: string | null; conditionPermit?: WorkflowPermitCondition | null };

export type WorkflowTemplateOption = {
  id: string;
  key: string;
  name: string;
  kind: WorkflowTemplateKind;
  trade: string | null;
  description: string | null;
  version: number;
  versionId: string;
  phaseCount: number;
  taskCount: number;
  scopeToggles: ScopeToggleDef[];
  /** Full keys ("roofing:permitting") as the tasks carry them — the jobs-list Phase filter. */
  phases: { key: string; shortKey: string; name: string; band: number }[];
  serviceCategoryNames: string[];
  suggested: boolean;
};

export type ApplyBody = {
  templateKeys: string[];
  permitStatus: WorkflowPermitStatus;
  scopeToggles: Record<string, Record<string, boolean>>;
  team?: Partial<Record<WorkflowRole, string | null>>;
  targetStartDate?: string | null;
  jurisdiction?: string | null;
  permit?: { notes?: string | null; documentFileId?: string | null };
};

export type PreviewTask = {
  key: string;
  phaseKey: string;
  title: string;
  role: WorkflowRole;
  assigneeId: string | null;
  dueAt: string | null;
  initiallyActive: boolean;
  blocking: boolean;
  exists: boolean;
};

export type WorkflowPreviewData = {
  modules: { moduleKey: string; kind: WorkflowTemplateKind; name: string; trade: string | null; version: number }[];
  phases: { key: string; name: string; moduleName: string; band: number; note: string | null; taskCount: number }[];
  tasks: PreviewTask[];
  counts: { tasks: number; toCreate: number; existing: number; phases: number; initiallyActive: number; waiting: number; blocking: number };
  estimatedBusinessDays: number;
  rolesUsed: WorkflowRole[];
  unassignedRoles: WorkflowRole[];
  potentialDuplicates: { taskId: string; title: string; matchesKey: string }[];
  warnings: string[];
};

export type ApplyResultData = {
  instanceId: string;
  created: number;
  existing: number;
  modules: string[];
  unassignedRoles: WorkflowRole[];
  warnings: string[];
};

export type PatchWorkflowBody = {
  team?: Partial<Record<WorkflowRole, string | null>>;
  permit?: { status: "REQUIRED" | "NOT_REQUIRED"; notes?: string | null; documentFileId?: string | null; jurisdiction?: string | null };
  scopeToggles?: Record<string, Record<string, boolean>>;
};

export type RoleDefaultRow = { role: WorkflowRole; label: string; user: (Person & { isActive: boolean }) | null; updatedAt: string | null };

export type { Priority, TaskStatus };

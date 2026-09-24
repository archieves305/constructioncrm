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
import type { Person, TaskListItem } from "@/components/tasks/types";
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

export type JobWorkflowData = {
  job: {
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
};

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

import type { WorkflowRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";

/**
 * The workflow team's PROJECT_MANAGER and SALES_REP slots and the job's own
 * `projectManagerId` / `salesRepId` are one fact seen from two places: the
 * Workflow tab writes the slot, the job page (and involvement, auto-tasks,
 * contracts, the field Today view) read the job field. Saving a slot
 * therefore writes the job field too. Clearing a slot means "fall back to
 * the job's field" and changes nothing.
 */

export type JobPeople = { projectManagerId: string | null; salesRepId: string | null };

export function jobFieldsFromTeam(team: Partial<Record<WorkflowRole, string | null>>, job: JobPeople): Partial<JobPeople> {
  const out: Partial<JobPeople> = {};
  if (team.PROJECT_MANAGER && team.PROJECT_MANAGER !== job.projectManagerId) out.projectManagerId = team.PROJECT_MANAGER;
  if (team.SALES_REP && team.SALES_REP !== job.salesRepId) out.salesRepId = team.SALES_REP;
  return out;
}

/** Apply the team → job mirror for one job; returns the fields that changed (empty when nothing did). */
export async function mirrorTeamToJob(input: {
  jobId: string;
  team: Partial<Record<WorkflowRole, string | null>>;
  actorUserId: string;
}): Promise<Partial<JobPeople>> {
  const job = await prisma.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, leadId: true, projectManagerId: true, salesRepId: true },
  });
  if (!job) return {};
  const changes = jobFieldsFromTeam(input.team, job);
  if (Object.keys(changes).length === 0) return {};

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: changes,
    select: {
      projectManagerId: true,
      salesRepId: true,
      projectManager: { select: { firstName: true, lastName: true } },
      salesRep: { select: { firstName: true, lastName: true } },
    },
  });

  const parts: string[] = [];
  if (changes.projectManagerId && updated.projectManager) parts.push(`PM → ${updated.projectManager.firstName} ${updated.projectManager.lastName}`);
  if (changes.salesRepId && updated.salesRep) parts.push(`sales rep → ${updated.salesRep.firstName} ${updated.salesRep.lastName}`);
  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "ASSIGNMENT_CHANGE",
      title: `Job ${parts.join(", ")} (from the workflow team)`,
      createdByUserId: input.actorUserId,
    },
  });
  await recordAudit({
    actorUserId: input.actorUserId,
    entityType: "Job",
    entityId: job.id,
    action: "assign",
    before: { salesRepId: job.salesRepId, projectManagerId: job.projectManagerId },
    after: { salesRepId: updated.salesRepId, projectManagerId: updated.projectManagerId, source: "workflow_team" },
  });
  return changes;
}

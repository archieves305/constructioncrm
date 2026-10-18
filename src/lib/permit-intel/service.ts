import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { FILE_LIST_INCLUDE, presentFiles } from "@/lib/files/list";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { TASK_LIST_INCLUDE } from "@/lib/tasks/include";
import { inspectionStepsForJob, updatePermit } from "@/lib/permits/service";
import { jurisdictionKey, jurisdictionKindFor, tidyJurisdictionName } from "./catalog";
import { applicableRequirements, checklistSummary, requirementChecklist, type RequirementRow } from "./requirements";
import { statusForOutcome } from "./submission-plan";
import type { CycleOutcomeInput, JurisdictionInput, PartyInput, RequirementInput } from "./validation";

/**
 * The permit record of Permit Intelligence: one permit's whole picture, its
 * parties and review cycles, and the settings behind them (jurisdictions,
 * the type catalog, the requirement checklist). The permit itself is still
 * written only through `lib/permits/service.ts` `updatePermit`. Every write
 * here is audited on the permit (`JobPermit`) or on the setting.
 */
type Actor = { id: string; role: RoleName };

export class PermitIntelError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "PermitIntelError";
  }
}

const audit = (actor: Actor, entityType: string, entityId: string, action: string, before?: unknown, after?: unknown) =>
  recordAudit({ actorUserId: actor.id, entityType, entityId, action, before, after });

// ─── One permit ─────────────────────────────────────────────────────────────

const REQUIREMENT_SELECT = {
  id: true,
  kind: true,
  status: true,
  jurisdictionId: true,
  permitTypeKey: true,
  title: true,
  body: true,
  documentType: true,
  required: true,
  reliability: true,
  sourceUrl: true,
  effectiveFrom: true,
  effectiveTo: true,
  sortOrder: true,
} satisfies Prisma.PermitKnowledgeSelect;

export async function loadRequirementsFor(permit: { jurisdictionId: string | null; permitTypeKey: string | null }, on: Date = new Date()): Promise<RequirementRow[]> {
  const rows = await prisma.permitKnowledge.findMany({
    where: { kind: "REQUIREMENT", status: "APPROVED", OR: [{ jurisdictionId: null }, ...(permit.jurisdictionId ? [{ jurisdictionId: permit.jurisdictionId }] : [])] },
    select: REQUIREMENT_SELECT,
  });
  return applicableRequirements(rows, permit, on);
}

export async function loadPermitDetail(id: string) {
  const permit = await prisma.jobPermit.findUnique({
    where: { id },
    include: {
      job: { select: { ...JOB_LABEL_SELECT, leadId: true, projectManagerId: true } },
      jurisdiction: { select: { id: true, name: true, kind: true, county: true, hvhz: true, portalUrl: true, submissionMethod: true, reviewDaysTarget: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      parties: { orderBy: [{ role: "asc" }, { createdAt: "asc" }], include: { organization: { select: { id: true, name: true, kind: true } }, contact: { select: { id: true, firstName: true, lastName: true } } } },
      cycles: {
        orderBy: { number: "desc" },
        include: {
          submission: {
            select: { id: true, kind: true, sha256: true, sizeBytes: true, manifest: true, method: true, confirmationRef: true, notes: true, submittedAt: true, submittedBy: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      },
      inspections: { orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }], include: { task: { select: { id: true, title: true, status: true } } } },
    },
  });
  if (!permit) return null;

  const [fileRows, tasks, history, requirements, steps] = await Promise.all([
    prisma.file.findMany({ where: { permitId: id }, orderBy: { createdAt: "desc" }, include: FILE_LIST_INCLUDE }),
    prisma.task.findMany({ where: { permitId: id }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], include: TASK_LIST_INCLUDE, take: 100 }),
    prisma.auditEvent.findMany({
      where: { entityType: "JobPermit", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, beforeJson: true, afterJson: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    }),
    loadRequirementsFor(permit),
    inspectionStepsForJob(permit.jobId),
  ]);
  const files = await presentFiles(fileRows);
  const checklist = requirementChecklist(requirements, files);
  return { permit, files, tasks, history, steps, checklist, checklistSummary: checklistSummary(checklist) };
}

// ─── Parties ────────────────────────────────────────────────────────────────

async function partyLinks(input: PartyInput) {
  if (input.organizationId && !(await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } }))) throw new PermitIntelError(400, "That company does not exist");
  if (input.contactId && !(await prisma.contact.findUnique({ where: { id: input.contactId }, select: { id: true } }))) throw new PermitIntelError(400, "That contact does not exist");
  if (input.vendorId && !(await prisma.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true } }))) throw new PermitIntelError(400, "That vendor does not exist");
}

export async function addParty(permitId: string, input: PartyInput, actor: Actor) {
  await partyLinks(input);
  const party = await prisma.permitParty.create({ data: { permitId, ...input } });
  await audit(actor, "JobPermit", permitId, "permit_party_add", undefined, { partyId: party.id, role: party.role, name: party.name, licenseNumber: party.licenseNumber });
  return party;
}

export async function updateParty(partyId: string, input: Partial<PartyInput>, actor: Actor) {
  const before = await prisma.permitParty.findUnique({ where: { id: partyId } });
  if (!before) throw new PermitIntelError(404, "Party not found");
  await partyLinks({ role: before.role, name: before.name, ...input } as PartyInput);
  const party = await prisma.permitParty.update({ where: { id: partyId }, data: input });
  await audit(actor, "JobPermit", before.permitId, "permit_party_update", { role: before.role, name: before.name, licenseNumber: before.licenseNumber }, { partyId, role: party.role, name: party.name, licenseNumber: party.licenseNumber });
  return party;
}

export async function deleteParty(partyId: string, actor: Actor) {
  const before = await prisma.permitParty.findUnique({ where: { id: partyId } });
  if (!before) throw new PermitIntelError(404, "Party not found");
  await prisma.permitParty.delete({ where: { id: partyId } });
  await audit(actor, "JobPermit", before.permitId, "permit_party_delete", { partyId, role: before.role, name: before.name });
}

// ─── Review cycles ──────────────────────────────────────────────────────────

/**
 * The building department answered a cycle. The permit's status follows
 * (approved → issued, corrections, denied, withdrawn → preparing) through
 * `updatePermit`, so its dates, alerts and gates move as they do for any
 * status change.
 */
export async function recordCycleOutcome(cycleId: string, input: CycleOutcomeInput, actor: Actor) {
  const cycle = await prisma.permitReviewCycle.findUnique({ where: { id: cycleId }, include: { permit: { select: { id: true, currentCycle: true, status: true } } } });
  if (!cycle) throw new PermitIntelError(404, "Review cycle not found");
  if (cycle.number !== cycle.permit.currentCycle) throw new PermitIntelError(409, `Only the latest review cycle (${cycle.permit.currentCycle}) can be answered`);
  const outcomeAt = input.outcome === "PENDING" ? null : (input.outcomeAt ?? new Date());
  const updated = await prisma.permitReviewCycle.update({
    where: { id: cycleId },
    data: { outcome: input.outcome, outcomeAt, reviewerName: input.reviewerName ?? cycle.reviewerName, notes: input.notes ?? cycle.notes },
  });
  await audit(actor, "JobPermit", cycle.permitId, "cycle_outcome", { cycle: cycle.number, outcome: cycle.outcome }, { cycle: cycle.number, outcome: updated.outcome, outcomeAt, reviewerName: updated.reviewerName });
  const next = statusForOutcome(input.outcome);
  if (next && next !== cycle.permit.status) {
    await updatePermit(cycle.permitId, { status: next, ...(next === "ISSUED" && input.permitNumber ? { permitNumber: input.permitNumber } : {}), ...(next === "ISSUED" && outcomeAt ? { approvedDate: outcomeAt.toISOString() } : {}) }, actor);
  } else if (input.permitNumber) {
    await updatePermit(cycle.permitId, { permitNumber: input.permitNumber }, actor);
  }
  return updated;
}

/** A submission made before packages existed: the cycle is recorded by hand (no package). */
export async function recordManualCycle(permitId: string, input: { submittedAt: Date; notes?: string | null }, actor: Actor) {
  const permit = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: { currentCycle: true, cycles: { orderBy: { number: "desc" }, take: 1, select: { outcome: true } } } });
  if (!permit) throw new PermitIntelError(404, "Permit not found");
  if (permit.cycles[0]?.outcome === "PENDING") throw new PermitIntelError(409, `Cycle ${permit.currentCycle} is still waiting on the building department. Record its outcome first.`);
  const number = permit.currentCycle + 1;
  const cycle = await prisma.$transaction(async (tx) => {
    const c = await tx.permitReviewCycle.create({ data: { permitId, number, submittedAt: input.submittedAt, notes: input.notes ?? null } });
    await tx.jobPermit.update({ where: { id: permitId }, data: { currentCycle: number } });
    return c;
  });
  await audit(actor, "JobPermit", permitId, "cycle_recorded", undefined, { cycle: number, submittedAt: input.submittedAt });
  await updatePermit(permitId, { status: "APPLIED", submittedDate: input.submittedAt.toISOString() }, actor);
  return cycle;
}

// ─── Jurisdictions ──────────────────────────────────────────────────────────

export async function listJurisdictions(opts: { includeInactive?: boolean } = {}) {
  return prisma.jurisdiction.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { permits: true, knowledge: true } }, organization: { select: { id: true, name: true } } },
  });
}

export async function createJurisdiction(input: JurisdictionInput, actor: Actor) {
  const name = tidyJurisdictionName(input.name);
  const key = jurisdictionKey(name);
  if (!key) throw new PermitIntelError(400, "Give the jurisdiction a name");
  if (await prisma.jurisdiction.findUnique({ where: { key }, select: { id: true } })) throw new PermitIntelError(409, `${name} is already on the list`);
  const j = await prisma.jurisdiction.create({ data: { ...input, name, key, kind: input.kind ?? jurisdictionKindFor(name) } });
  await audit(actor, "Jurisdiction", j.id, "create", undefined, { name: j.name, kind: j.kind });
  return j;
}

export async function updateJurisdiction(id: string, input: Partial<JurisdictionInput> & { isActive?: boolean }, actor: Actor) {
  const before = await prisma.jurisdiction.findUnique({ where: { id } });
  if (!before) throw new PermitIntelError(404, "Jurisdiction not found");
  const data: Prisma.JurisdictionUncheckedUpdateInput = { ...input };
  if (input.name !== undefined) {
    const name = tidyJurisdictionName(input.name);
    const key = jurisdictionKey(name);
    const clash = await prisma.jurisdiction.findUnique({ where: { key }, select: { id: true } });
    if (clash && clash.id !== id) throw new PermitIntelError(409, `${name} is already on the list`);
    Object.assign(data, { name, key });
  }
  const j = await prisma.$transaction(async (tx) => {
    const row = await tx.jurisdiction.update({ where: { id }, data });
    // the permits' text follows a rename
    if (input.name !== undefined && row.name !== before.name) await tx.jobPermit.updateMany({ where: { jurisdictionId: id }, data: { municipality: row.name } });
    return row;
  });
  await audit(actor, "Jurisdiction", id, "update", { name: before.name, isActive: before.isActive }, { name: j.name, isActive: j.isActive });
  return j;
}

// ─── Permit types ───────────────────────────────────────────────────────────

export async function listPermitTypes() {
  return prisma.permitTypeDef.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { key: true, name: true } });
}

// ─── Requirements ───────────────────────────────────────────────────────────

export async function listRequirements(filter: { jurisdictionId?: string | null } = {}) {
  return prisma.permitKnowledge.findMany({
    where: { kind: "REQUIREMENT", ...(filter.jurisdictionId !== undefined ? { jurisdictionId: filter.jurisdictionId } : {}) },
    orderBy: [{ status: "asc" }, { jurisdictionId: "asc" }, { permitTypeKey: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
    include: { jurisdiction: { select: { id: true, name: true } } },
  });
}

async function checkRequirementLinks(input: Partial<RequirementInput>) {
  if (input.jurisdictionId && !(await prisma.jurisdiction.findUnique({ where: { id: input.jurisdictionId }, select: { id: true } }))) throw new PermitIntelError(400, "That jurisdiction does not exist");
  if (input.permitTypeKey && !(await prisma.permitTypeDef.findUnique({ where: { key: input.permitTypeKey }, select: { key: true } }))) throw new PermitIntelError(400, "That permit type does not exist");
}

export async function createRequirement(input: RequirementInput, actor: Actor) {
  await checkRequirementLinks(input);
  const r = await prisma.permitKnowledge.create({ data: { ...input, kind: "REQUIREMENT", status: "APPROVED", createdByUserId: actor.id, decidedByUserId: actor.id, decidedAt: new Date() } });
  await audit(actor, "PermitKnowledge", r.id, "create", undefined, { title: r.title, jurisdictionId: r.jurisdictionId, permitTypeKey: r.permitTypeKey, documentType: r.documentType, required: r.required });
  return r;
}

export async function updateRequirement(id: string, input: Partial<RequirementInput> & { status?: "APPROVED" | "RETIRED" }, actor: Actor) {
  const before = await prisma.permitKnowledge.findUnique({ where: { id } });
  if (!before || before.kind !== "REQUIREMENT") throw new PermitIntelError(404, "Requirement not found");
  await checkRequirementLinks(input);
  const r = await prisma.permitKnowledge.update({ where: { id }, data: { ...input, ...(input.status ? { decidedByUserId: actor.id, decidedAt: new Date() } : {}) } });
  await audit(actor, "PermitKnowledge", id, "update", { title: before.title, required: before.required, status: before.status }, { title: r.title, required: r.required, status: r.status });
  return r;
}

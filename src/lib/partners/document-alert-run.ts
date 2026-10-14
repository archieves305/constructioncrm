import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { pinAllDay, todayKey, type DayKey } from "@/lib/time/zone";
import { DOC_ALERT_PREFIX, docAlertKey, liveDocumentAlertKeys, liveQualificationAlertKeys, planDocumentAlerts, planQualificationAlerts, qualAlertKey, qualAlertPrefix, type CurrentDocRow, type PlannedAlert, type QualRow } from "./document-alerts";
import { getPartnerSettings } from "./settings";

/**
 * Vault and qualification expiries as ordinary tasks: a certificate inside
 * 30 days of lapsing (and again once it has), an approval about to run out,
 * a renewal day reached. The daily cron raises; every document and
 * qualification write settles, so an alert the record has overtaken closes
 * by itself. A task is raised once per source key, whatever became of it.
 */

/** Who gets the vault's tasks: the vault owner under Admin → Business Development, else the Accounting role default, else the oldest admin. */
export async function vaultOwnerId(): Promise<string | null> {
  const s = await getPartnerSettings();
  if (s.vaultOwner?.isActive) return s.vaultOwner.id;
  const accounting = await prisma.workflowRoleDefault.findUnique({ where: { role: "ACCOUNTING" }, select: { user: { select: { id: true, isActive: true } } } });
  if (accounting?.user.isActive) return accounting.user.id;
  const admin = await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return admin?.id ?? null;
}

async function raise(alert: PlannedAlert, assignee: string): Promise<boolean> {
  const seen = await prisma.task.findFirst({ where: { sourceKey: alert.sourceKey }, select: { id: true } });
  if (seen) return false;
  await createTask(
    { title: alert.title, description: alert.description, priority: alert.priority, dueAt: pinAllDay(alert.dueDay), allDay: true, assignedUserId: assignee, createdByUserId: assignee, organizationId: alert.organizationId, source: "auto", sourceKey: alert.sourceKey },
    { actorUserId: null, notify: "inline" },
  );
  return true;
}

/** The current version of every dated type, with the accounts whose active qualifications attach it. */
async function loadCurrentDocs(): Promise<CurrentDocRow[]> {
  const docs = await prisma.companyDocument.findMany({
    orderBy: [{ documentTypeId: "asc" }, { version: "desc" }],
    select: { id: true, title: true, documentTypeId: true, expiresAt: true, documentType: { select: { name: true } }, requirements: { where: { qualification: { status: { in: ["SUBMITTED", "INFO_REQUESTED", "APPROVED"] } } }, select: { qualification: { select: { organization: { select: { name: true } } } } } } },
  });
  const seen = new Set<string>();
  const out: CurrentDocRow[] = [];
  for (const d of docs) {
    if (seen.has(d.documentTypeId)) continue;
    seen.add(d.documentTypeId);
    out.push({ id: d.id, title: d.title, typeName: d.documentType.name, expiresAt: d.expiresAt, usedBy: Array.from(new Set(d.requirements.map((r) => r.qualification.organization.name))) });
  }
  return out;
}

async function loadApprovedQuals(organizationId?: string): Promise<QualRow[]> {
  const rows = await prisma.qualification.findMany({
    where: { status: "APPROVED", ...(organizationId ? { organizationId } : {}), organization: { isActive: true } },
    select: { id: true, organizationId: true, status: true, expiresAt: true, renewalDueAt: true, platform: true, organization: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, organizationId: r.organizationId, organizationName: r.organization.name, status: r.status, expiresAt: r.expiresAt, renewalDueAt: r.renewalDueAt, platform: r.platform }));
}

export type DocumentAlertRun = { documents: number; qualifications: number; raised: number; expiring: number; expired: number; renewal: number };

/** Daily: raise what the vault and the approved qualifications call for. */
export async function raiseDocumentAlerts(today: DayKey = todayKey()): Promise<DocumentAlertRun> {
  const out: DocumentAlertRun = { documents: 0, qualifications: 0, raised: 0, expiring: 0, expired: 0, renewal: 0 };
  const [docs, quals] = await Promise.all([loadCurrentDocs(), loadApprovedQuals()]);
  out.documents = docs.length;
  out.qualifications = quals.length;
  const plans = [...planDocumentAlerts(docs, today), ...planQualificationAlerts(quals, today)];
  if (plans.length === 0) return out;
  const assignee = await vaultOwnerId();
  if (!assignee) return out;
  for (const p of plans) {
    try {
      // An account's qualification tasks go to its owner when it has one.
      let who = assignee;
      if (p.organizationId) {
        const org = await prisma.organization.findUnique({ where: { id: p.organizationId }, select: { owner: { select: { id: true, isActive: true } } } });
        if (org?.owner?.isActive) who = org.owner.id;
      }
      if (!(await raise(p, who))) continue;
      out.raised += 1;
      out[p.kind] += 1;
      if (p.kind === "expired") {
        // The lapsed task replaces the reminder.
        const [, rest] = p.sourceKey.split(/:(expired)@/);
        void rest;
        const day = p.sourceKey.split("@")[1]!;
        const expiringKey = p.sourceKey.startsWith(DOC_ALERT_PREFIX) ? docAlertKey(p.sourceKey.slice(DOC_ALERT_PREFIX.length).split(":")[0]!, "expiring", day) : qualAlertKey(p.organizationId!, p.sourceKey.split(":")[3]!, "expiring", day);
        await closeAutoTask(expiringKey, { actorUserId: null, outcome: "CANCELLED", because: "It has now expired — the newer follow-up replaces this one" });
      }
    } catch (err) {
      logger.exception(err, { where: "partners.raiseDocumentAlerts", sourceKey: p.sourceKey });
    }
  }
  return out;
}

async function settleByPrefix(prefix: string, live: Set<string>, actorUserId: string | null, because: string): Promise<number> {
  const open = await prisma.task.findMany({ where: { sourceKey: { startsWith: prefix }, status: { in: [...OPEN_TASK_STATUSES] } }, select: { sourceKey: true } });
  let closed = 0;
  for (const key of new Set(open.map((t) => t.sourceKey as string))) {
    if (live.has(key)) continue;
    closed += (await closeAutoTask(key, { actorUserId, outcome: "COMPLETED", because })).closed;
  }
  return closed;
}

/** After any vault write: close the document alerts the record has overtaken. Never throws. */
export async function settleDocumentAlerts(actorUserId: string | null, because = "A newer version was filed in the vault"): Promise<number> {
  try {
    return await settleByPrefix(DOC_ALERT_PREFIX, liveDocumentAlertKeys(await loadCurrentDocs()), actorUserId, because);
  } catch (err) {
    logger.exception(err, { where: "partners.settleDocumentAlerts" });
    return 0;
  }
}

/** After any qualification write on an account: close its qualification alerts the record has overtaken. Never throws. */
export async function settleQualificationAlerts(organizationId: string, actorUserId: string | null, because = "The qualification's dates or status changed"): Promise<number> {
  try {
    return await settleByPrefix(qualAlertPrefix(organizationId), liveQualificationAlertKeys(await loadApprovedQuals(organizationId)), actorUserId, because);
  } catch (err) {
    logger.exception(err, { where: "partners.settleQualificationAlerts", organizationId });
    return 0;
  }
}

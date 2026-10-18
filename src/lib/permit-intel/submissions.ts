import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { readFile, saveFile } from "@/lib/files/storage";
import { FILE_LIST_INCLUDE, presentFiles } from "@/lib/files/list";
import { logger } from "@/lib/logger";
import { updatePermit } from "@/lib/permits/service";
import { onResubmitted } from "./corrections";
import { PermitIntelError } from "./service";
import { nextCycle, planManifest, type ManifestEntry } from "./submission-plan";
import type { SubmissionInput } from "./validation";

/**
 * A submission frozen as it was sent: one zip of exactly the chosen
 * documents, with a contents sheet, the sha256 of every document and of the
 * zip itself. The package is never changed and its documents can no longer
 * be deleted, renamed or replaced (`permitLockOf`). Freezing opens the next
 * review cycle and puts the permit in review (`updatePermit`, so its alerts
 * and the workflow's gates follow).
 */
type Actor = { id: string; role: RoleName };

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const COMPRESSIBLE = /\.(txt|csv|docx|xlsx|doc|xls)$/i;

export type FrozenManifestEntry = ManifestEntry & { sha256: string };

function contentsSheet(meta: { permit: string; address: string; jurisdiction: string; cycle: number; kind: string; method: string; confirmationRef: string | null; submittedAt: Date; by: string }, entries: FrozenManifestEntry[]): string {
  const lines = [
    `Permit submission — ${meta.permit}`,
    `Property: ${meta.address}`,
    `Jurisdiction: ${meta.jurisdiction}`,
    `Review cycle ${meta.cycle} (${meta.kind.toLowerCase()}), sent by ${meta.method.toLowerCase().replace(/_/g, " ")}${meta.confirmationRef ? `, confirmation ${meta.confirmationRef}` : ""}`,
    `Submitted ${meta.submittedAt.toISOString()} by ${meta.by}`,
    "",
    "Documents (sha256):",
    ...entries.map((e) => `  ${e.entry}\n    ${e.sha256}  ${e.bytes} bytes`),
    "",
  ];
  return lines.join("\n");
}

export async function freezeSubmission(permitId: string, input: SubmissionInput, actor: Actor & { name: string }) {
  const permit = await prisma.jobPermit.findUnique({
    where: { id: permitId },
    select: {
      id: true,
      municipality: true,
      permitType: true,
      permitNumber: true,
      applicationNumber: true,
      job: { select: { lead: { select: { propertyAddress1: true, city: true, state: true, zipCode: true } } } },
      cycles: { select: { id: true, number: true, outcome: true, submission: { select: { id: true } } } },
    },
  });
  if (!permit) throw new PermitIntelError(404, "Permit not found");
  const next = nextCycle(permit.cycles.map((c) => ({ id: c.id, number: c.number, outcome: c.outcome, hasSubmission: !!c.submission })));
  if (!next.ok) throw new PermitIntelError(409, next.reason);

  const ids = [...new Set(input.fileIds)];
  const rows = await prisma.file.findMany({ where: { id: { in: ids }, permitId }, include: FILE_LIST_INCLUDE });
  if (rows.length !== ids.length) throw new PermitIntelError(400, "Every document in a submission must be one of this permit's documents");
  const presented = await presentFiles(rows);
  const plan = planManifest(presented.map((f) => ({ id: f.id, fileName: f.fileName, permitDocType: f.permitDocType, fileSize: f.fileSize, missing: f.missing })));
  if (plan.missing.length) throw new PermitIntelError(409, `These documents are missing from the store and cannot be sent: ${plan.missing.map((f) => f.fileName).join(", ")}. Upload them again first.`);

  const keyOf = new Map(rows.map((r) => [r.id, r.storageKey]));
  const zipFiles: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const entries: FrozenManifestEntry[] = [];
  for (const e of plan.entries) {
    const bytes = new Uint8Array(await readFile(keyOf.get(e.fileId)!));
    entries.push({ ...e, bytes: bytes.length, sha256: sha256(bytes) });
    zipFiles[e.entry] = [bytes, { level: COMPRESSIBLE.test(e.name) ? 6 : 0 }];
  }
  const submittedAt = input.submittedAt ?? new Date();
  const lead = permit.job.lead;
  const permitName = `${permit.permitType ?? "Permit"}${permit.applicationNumber ? ` · application ${permit.applicationNumber}` : ""}${permit.permitNumber ? ` · permit ${permit.permitNumber}` : ""}`;
  const sheet = contentsSheet(
    { permit: permitName, address: [lead.propertyAddress1, lead.city, lead.state, lead.zipCode].filter(Boolean).join(", "), jurisdiction: permit.municipality, cycle: next.number, kind: next.kind, method: input.method, confirmationRef: input.confirmationRef ?? null, submittedAt, by: actor.name },
    entries,
  );
  zipFiles["00 - Contents.txt"] = [new TextEncoder().encode(sheet), { level: 6 }];
  const zip = zipSync(zipFiles);
  const zipHash = sha256(zip);
  const stored = await saveFile(Buffer.from(zip), `permit-submission-cycle-${next.number}.zip`);

  const submission = await prisma.$transaction(async (tx) => {
    const cycle = next.reuseCycleId
      ? await tx.permitReviewCycle.update({ where: { id: next.reuseCycleId }, data: { submittedAt } })
      : await tx.permitReviewCycle.create({ data: { permitId, number: next.number, submittedAt } });
    const s = await tx.permitSubmission.create({
      data: {
        permitId,
        cycleId: cycle.id,
        kind: next.kind,
        storageKey: stored.storageKey,
        sha256: zipHash,
        sizeBytes: stored.bytes,
        manifest: entries as unknown as Prisma.InputJsonValue,
        method: input.method,
        confirmationRef: input.confirmationRef ?? null,
        notes: input.notes ?? null,
        submittedAt,
        submittedByUserId: actor.id,
        files: { create: entries.map((e) => ({ fileId: e.fileId, sha256: e.sha256 })) },
      },
    });
    await tx.jobPermit.update({ where: { id: permitId }, data: { currentCycle: next.number } });
    return s;
  });
  await recordAudit({
    actorUserId: actor.id,
    entityType: "JobPermit",
    entityId: permitId,
    action: "submission_freeze",
    after: { submissionId: submission.id, cycle: next.number, kind: next.kind, method: input.method, confirmationRef: input.confirmationRef ?? null, sha256: zipHash, documents: entries.map((e) => ({ fileId: e.fileId, name: e.name, sha256: e.sha256 })) },
  });
  // in review from today: the waiting clock, the alerts and the gates follow
  await updatePermit(permitId, { status: "APPLIED", submittedDate: submittedAt.toISOString() }, actor);
  await onResubmitted(permitId, next.number, actor.id);
  return submission;
}

/** The frozen zip, checked against the hash it was frozen with. */
export async function readSubmission(submissionId: string) {
  const s = await prisma.permitSubmission.findUnique({ where: { id: submissionId }, select: { id: true, permitId: true, storageKey: true, sha256: true, cycle: { select: { number: true } }, permit: { select: { jobId: true } } } });
  if (!s) throw new PermitIntelError(404, "Submission not found");
  let bytes: Buffer;
  try {
    bytes = await readFile(s.storageKey);
  } catch {
    throw new PermitIntelError(404, "The submitted package is missing from the store");
  }
  if (sha256(bytes) !== s.sha256) {
    logger.error("permit submission hash mismatch", { submissionId });
    throw new PermitIntelError(409, "The stored package no longer matches what was submitted. It has not been served; tell an administrator.");
  }
  return { ...s, bytes, fileName: `permit-submission-cycle-${s.cycle.number}.zip` };
}

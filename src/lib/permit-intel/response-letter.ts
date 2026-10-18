import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { saveFile } from "@/lib/files/storage";
import { formatAddressLine } from "@/lib/labels/address";
import { renderCorrectionResponsePdf } from "@/lib/pdf/permit-correction-response";
import { dayKey, dayKeyToLocalDate } from "@/lib/time/zone";
import { letterLines, type CorrectionStatus } from "./corrections-plan";
import { PermitIntelError } from "./service";

/**
 * The response letter for one confirmed notice, filed on the permit as a
 * `correction_response` document (a new file each time: an earlier letter
 * stays as it was, and one already sent in a package is locked anyway).
 */
type Actor = { id: string; role: RoleName; name: string };

const longDay = (d: Date) => dayKeyToLocalDate(dayKey(d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export async function generateResponseLetter(noticeId: string, actor: Actor) {
  const n = await prisma.permitCorrectionNotice.findUnique({
    where: { id: noticeId },
    include: {
      cycle: { select: { number: true } },
      items: { orderBy: { sortOrder: "asc" }, include: { files: { orderBy: { createdAt: "asc" }, select: { file: { select: { fileName: true } } } } } },
      permit: {
        select: {
          id: true,
          municipality: true,
          permitType: true,
          applicationNumber: true,
          permitNumber: true,
          jobId: true,
          job: { select: { leadId: true, lead: { select: { propertyAddress1: true, propertyAddress2: true, city: true, state: true, zipCode: true } } } },
        },
      },
    },
  });
  if (!n) throw new PermitIntelError(404, "Notice not found");
  if (n.status !== "CONFIRMED") throw new PermitIntelError(409, "Confirm the notice's items before writing the response");
  const { lines, unanswered } = letterLines(
    n.items.map((i) => ({ id: i.id, reviewerItemNumber: i.reviewerItemNumber, reviewerDiscipline: i.reviewerDiscipline, text: i.text, response: i.response, status: i.status as CorrectionStatus, revisedFiles: i.files.map((f) => f.file.fileName) })),
  );
  if (!lines.length) throw new PermitIntelError(400, "The notice has no confirmed items to answer");
  if (unanswered.length) {
    const names = unanswered.map((u) => u.reviewerItemNumber ?? `#${n.items.findIndex((i) => i.id === u.id) + 1}`).join(", ");
    throw new PermitIntelError(409, `Write a response for every comment first. Still blank: ${names}.`);
  }
  const address = formatAddressLine(n.permit.job.lead) || "the property";
  const pdf = await renderCorrectionResponsePdf({
    date: longDay(new Date()),
    jurisdiction: n.permit.municipality,
    address,
    permitType: n.permit.permitType,
    applicationNumber: n.permit.applicationNumber,
    permitNumber: n.permit.permitNumber,
    cycle: n.cycle.number,
    reviewerName: n.reviewerName,
    noticeDate: longDay(n.receivedAt),
    lines,
    signer: actor.name,
  });
  const fileName = `Correction response - cycle ${n.cycle.number}.pdf`;
  const stored = await saveFile(pdf, fileName);
  const file = await prisma.file.create({
    data: {
      leadId: n.permit.job.leadId,
      jobId: n.permit.jobId,
      permitId: n.permit.id,
      permitDocType: "correction_response",
      fileName,
      fileType: "application/pdf",
      fileSize: stored.bytes,
      storageKey: stored.storageKey,
      category: "PERMIT",
      uploadedByUserId: actor.id,
      extractedText: lines.map((l) => `${l.number} ${l.comment}\n${l.response}`).join("\n\n"),
    },
    select: { id: true, fileName: true },
  });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: n.permit.id, action: "correction_response_letter", after: { noticeId, fileId: file.id, cycle: n.cycle.number, comments: lines.length } });
  return file;
}

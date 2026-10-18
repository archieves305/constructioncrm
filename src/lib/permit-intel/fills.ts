import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { deleteFile, readFile, saveFile } from "@/lib/files/storage";
import { formatAddressLine } from "@/lib/labels/address";
import { logger } from "@/lib/logger";
import { loadEstimateBrand } from "@/lib/pdf/brand";
import type { FormContext } from "./data-dictionary";
import { finalizeProblems, planFill, summarize, type FieldMap, type FillValue } from "./field-fill";
import { fillForm } from "./form-pdf";
import { inventoryOf, templatesForPermit } from "./forms";
import { indexPermitFileText } from "./library";
import { PermitIntelError } from "./service";

/**
 * Filling a published form for one permit. The values are read from the
 * records each time the fill is opened (so a parcel number added to the lead
 * shows at once), a person's overrides kept on top. Writing the PDF files it
 * on the permit twice — editable and flattened — as a completed application.
 * A final fill keeps its values and files as they were.
 */
type Actor = { id: string; role: RoleName };

const audit = (actor: { id: string }, permitId: string, action: string, after?: unknown) =>
  recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: permitId, action, after });

const name = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}`.trim() || null : null);

export async function loadFormContext(permitId: string, today: Date = new Date()): Promise<FormContext> {
  const p = await prisma.jobPermit.findUnique({
    where: { id: permitId },
    select: {
      permitType: true,
      permitTypeKey: true,
      scopeDescription: true,
      valuation: true,
      applicationNumber: true,
      permitNumber: true,
      municipality: true,
      jurisdiction: { select: { name: true, county: true } },
      assignedTo: { select: { firstName: true, lastName: true } },
      parties: { select: { role: true, name: true, email: true, phone: true, licenseNumber: true }, orderBy: { createdAt: "asc" } },
      job: {
        select: {
          jobNumber: true,
          targetStartDate: true,
          projectManager: { select: { firstName: true, lastName: true } },
          lead: {
            select: { fullName: true, companyName: true, primaryPhone: true, email: true, propertyAddress1: true, propertyAddress2: true, city: true, state: true, zipCode: true, county: true, mailingAddress1: true, mailingAddress2: true, parcelNumber: true, legalDescription: true },
          },
        },
      },
    },
  });
  if (!p) throw new PermitIntelError(404, "Permit not found");
  const brand = await loadEstimateBrand();
  return {
    today,
    permit: {
      permitType: p.permitType,
      permitTypeKey: p.permitTypeKey,
      scopeDescription: p.scopeDescription,
      valuation: p.valuation == null ? null : Number(p.valuation),
      applicationNumber: p.applicationNumber,
      permitNumber: p.permitNumber,
      municipality: p.municipality,
      jurisdiction: p.jurisdiction,
      coordinatorName: name(p.assignedTo),
    },
    job: { jobNumber: p.job.jobNumber, targetStartDate: p.job.targetStartDate, projectManagerName: name(p.job.projectManager) },
    lead: p.job.lead,
    contractor: { companyName: brand.companyName, addressLine1: brand.addressLine1, addressLine2: brand.addressLine2, city: brand.city, state: brand.state, zip: brand.zip, phone: brand.phone, email: brand.email, gcLicense: brand.gcLicense, roofingLicense: brand.roofingLicense },
    parties: p.parties,
  };
}

const FILL_INCLUDE = {
  template: { select: { id: true, name: true, version: true, status: true, pageCount: true, fieldInventory: true, fields: { select: { fieldName: true, dataKey: true, transform: true } } } },
  outputFile: { select: { id: true, fileName: true, fileSize: true } },
  flattenedFile: { select: { id: true, fileName: true, fileSize: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  finalizedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.PermitFormFillInclude;

type FillRow = Prisma.PermitFormFillGetPayload<{ include: typeof FILL_INCLUDE }>;

const overridesOf = (f: { overrides: unknown }) => (f.overrides ?? {}) as Record<string, string>;

/** A draft's values as of now; a final fill's as they were finalised. */
async function present(f: FillRow, ctx?: FormContext) {
  let values = f.values as unknown as FillValue[];
  if (f.status === "DRAFT") {
    values = planFill(inventoryOf(f.template), f.template.fields as FieldMap[], ctx ?? (await loadFormContext(f.permitId)), overridesOf(f));
  }
  const { fieldInventory: _inv, fields: _maps, ...template } = f.template;
  void _inv;
  void _maps;
  return { ...f, template, values, summary: summarize(values), problems: finalizeProblems(values) };
}

export async function listFills(permitId: string) {
  const permit = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: { jurisdictionId: true, permitTypeKey: true, jurisdiction: { select: { county: true } } } });
  if (!permit) throw new PermitIntelError(404, "Permit not found");
  const rows = await prisma.permitFormFill.findMany({ where: { permitId }, orderBy: { createdAt: "desc" }, include: FILL_INCLUDE });
  const ctx = rows.some((r) => r.status === "DRAFT") ? await loadFormContext(permitId) : undefined;
  const fills = await Promise.all(rows.map((r) => present(r, ctx)));
  const available = await templatesForPermit({ jurisdictionId: permit.jurisdictionId, permitTypeKey: permit.permitTypeKey, county: permit.jurisdiction?.county ?? null });
  return { fills, available };
}

export async function createFill(permitId: string, templateId: string, actor: Actor) {
  const permit = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: { jurisdictionId: true, permitTypeKey: true, jurisdiction: { select: { county: true } } } });
  if (!permit) throw new PermitIntelError(404, "Permit not found");
  const applies = await templatesForPermit({ jurisdictionId: permit.jurisdictionId, permitTypeKey: permit.permitTypeKey, county: permit.jurisdiction?.county ?? null });
  if (!applies.some((t) => t.id === templateId)) throw new PermitIntelError(400, "That form is not a published form for this permit's jurisdiction and type");
  const t = await prisma.permitFormTemplate.findUniqueOrThrow({ where: { id: templateId }, select: { fieldInventory: true, fields: { select: { fieldName: true, dataKey: true, transform: true } } } });
  const values = planFill(inventoryOf(t), t.fields, await loadFormContext(permitId), {});
  const f = await prisma.permitFormFill.create({ data: { permitId, templateId, values: values as unknown as Prisma.InputJsonValue, createdByUserId: actor.id }, include: FILL_INCLUDE });
  await audit(actor, permitId, "form_fill_create", { fillId: f.id, templateId, summary: summarize(values) });
  return present(f);
}

async function draftOf(fillId: string) {
  const f = await prisma.permitFormFill.findUnique({ where: { id: fillId }, include: FILL_INCLUDE });
  if (!f) throw new PermitIntelError(404, "Form not found");
  if (f.status !== "DRAFT") throw new PermitIntelError(409, "This form is final and no longer changes");
  return f;
}

export async function getFill(fillId: string) {
  const f = await prisma.permitFormFill.findUnique({ where: { id: fillId }, include: FILL_INCLUDE });
  if (!f) throw new PermitIntelError(404, "Form not found");
  return present(f);
}

/** A person's value for one field; null removes it and the record's value comes back. */
export async function setOverride(fillId: string, field: string, value: string | null, actor: Actor) {
  const f = await draftOf(fillId);
  const inv = inventoryOf(f.template);
  const target = inv.find((i) => i.name === field);
  if (!target) throw new PermitIntelError(400, "That is not a field of this form");
  if (target.type === "signature") throw new PermitIntelError(400, "A signature is signed by hand");
  const overrides = { ...overridesOf(f) };
  if (value === null) delete overrides[field];
  else overrides[field] = value;
  const u = await prisma.permitFormFill.update({ where: { id: fillId }, data: { overrides }, include: FILL_INCLUDE });
  await audit(actor, f.permitId, "form_fill_override", { fillId, field, cleared: value === null });
  return present(u);
}

/** Old output of a draft goes when a new one is written — unless it was sent in a package. */
async function dropOutput(fileId: string | null) {
  if (!fileId) return;
  const file = await prisma.file.findUnique({ where: { id: fileId }, select: { id: true, storageKey: true, _count: { select: { permitSubmissions: true } } } });
  if (!file || file._count.permitSubmissions) return;
  await prisma.file.delete({ where: { id: file.id } });
  await deleteFile(file.storageKey).catch(() => undefined);
}

/** Write the PDF: the editable copy and the flattened one, both on the permit's Documents. */
export async function renderFill(fillId: string, actor: Actor) {
  const f = await draftOf(fillId);
  const permit = await prisma.jobPermit.findUniqueOrThrow({ where: { id: f.permitId }, select: { id: true, jobId: true, job: { select: { leadId: true, lead: { select: { propertyAddress1: true, propertyAddress2: true, city: true, state: true, zipCode: true } } } } } });
  const values = planFill(inventoryOf(f.template), f.template.fields as FieldMap[], await loadFormContext(f.permitId), overridesOf(f));
  const t = await prisma.permitFormTemplate.findUniqueOrThrow({ where: { id: f.templateId }, select: { storageKey: true } });
  let blank: Buffer;
  try {
    blank = await readFile(t.storageKey);
  } catch {
    throw new PermitIntelError(409, "The blank form is missing from the store; upload it again under Admin → Permits → Forms");
  }
  const out = await fillForm(new Uint8Array(blank), values);
  const address = (permit.job.lead.propertyAddress1 || formatAddressLine(permit.job.lead) || "permit").replace(/[\\/:*?"<>|]+/g, " ").trim();
  const base = `${f.template.name} - ${address}`.slice(0, 150);
  const save = async (bytes: Uint8Array, fileName: string) => {
    const stored = await saveFile(Buffer.from(bytes), fileName);
    return prisma.file.create({
      data: { leadId: permit.job.leadId, jobId: permit.jobId, permitId: permit.id, permitDocType: "completed_application", category: "PERMIT", fileName, fileType: "application/pdf", fileSize: stored.bytes, storageKey: stored.storageKey, uploadedByUserId: actor.id },
      select: { id: true },
    });
  };
  const editable = await save(out.editable, `${base} (editable).pdf`);
  const flattened = await save(out.flattened, `${base}.pdf`);
  await Promise.all([dropOutput(f.outputFileId), dropOutput(f.flattenedFileId)]);
  const u = await prisma.permitFormFill.update({ where: { id: fillId }, data: { values: values as unknown as Prisma.InputJsonValue, outputFileId: editable.id, flattenedFileId: flattened.id }, include: FILL_INCLUDE });
  void indexPermitFileText(flattened.id);
  if (out.skipped.length) logger.warn("form fill skipped fields", { fillId, skipped: out.skipped });
  await audit(actor, f.permitId, "form_fill_render", { fillId, files: [editable.id, flattened.id], skipped: out.skipped, summary: summarize(values) });
  return { ...(await present(u)), skipped: out.skipped };
}

/**
 * A person finalises the form: written once more from the records as they
 * stand, then kept as it is. Refused while the records disagree on a field or
 * a choice matches none of the form's options.
 */
export async function finalizeFill(fillId: string, actor: Actor) {
  const f = await draftOf(fillId);
  const values = planFill(inventoryOf(f.template), f.template.fields as FieldMap[], await loadFormContext(f.permitId), overridesOf(f));
  const problems = finalizeProblems(values);
  if (problems.length) throw new PermitIntelError(409, `Settle these first: ${problems.join("; ")}.`);
  await renderFill(fillId, actor);
  const claimed = await prisma.permitFormFill.updateMany({ where: { id: fillId, status: "DRAFT" }, data: { status: "FINAL", finalizedByUserId: actor.id, finalizedAt: new Date() } });
  if (!claimed.count) throw new PermitIntelError(409, "This form was just finalised");
  await audit(actor, f.permitId, "form_fill_finalize", { fillId, summary: summarize(values) });
  return getFill(fillId);
}

/** A draft that is not wanted: removed with its output files (a file sent in a package stays). */
export async function deleteFill(fillId: string, actor: Actor) {
  const f = await draftOf(fillId);
  await prisma.permitFormFill.delete({ where: { id: fillId } });
  await Promise.all([dropOutput(f.outputFileId), dropOutput(f.flattenedFileId)]);
  await audit(actor, f.permitId, "form_fill_delete", { fillId });
}

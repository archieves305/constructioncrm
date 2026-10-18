import { createHash } from "node:crypto";
import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { runAiCall } from "@/lib/ai/calls";
import { AI_NOT_CONFIGURED, AiError, defaultModel, isAiConfigured } from "@/lib/ai/client";
import { readFile, saveFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import { acceptMapping, mappingProblem, type FieldMap, type InventoryField } from "./field-fill";
import { readInventory } from "./form-pdf";
import * as formMap from "./prompts/form-map";
import { PermitIntelError } from "./service";

/**
 * Form templates: a municipality's blank fillable application, its fields,
 * and what each field means. The AI proposes the mapping, a person edits and
 * publishes it. A published template never changes: editing one starts the
 * next version of the same file, and publishing that retires the older one.
 * The blank file itself is stored once and served from here.
 */
type Actor = { id: string; role: RoleName };

const audit = (actor: { id: string } | null, id: string, action: string, before?: unknown, after?: unknown) =>
  recordAudit({ actorUserId: actor?.id ?? null, entityType: "PermitFormTemplate", entityId: id, action, before, after });

const MAP_STALE_MS = 5 * 60 * 1000;

export type TemplateMeta = { name: string; jurisdictionId?: string | null; county?: string | null; permitTypeKeys?: string[]; notes?: string | null };

/** A blank form uploaded: its fields are read; a form with no fields or an XFA form is refused with the reason. */
export async function createTemplate(file: { name: string; bytes: Buffer }, meta: TemplateMeta, actor: Actor) {
  if (file.bytes.subarray(0, 5).toString() !== "%PDF-") throw new PermitIntelError(400, "Upload the blank form as a PDF");
  let inv;
  try {
    inv = await readInventory(new Uint8Array(file.bytes));
  } catch (err) {
    logger.warn("form not readable", { message: err instanceof Error ? err.message : String(err) });
    throw new PermitIntelError(400, "This PDF could not be read as a form. If it is password-protected, upload an unprotected copy.");
  }
  if (inv.kind === "XFA") throw new PermitIntelError(400, "This is an XFA form (an Adobe LiveCycle form). It cannot be filled field by field; ask the department for a standard fillable PDF, or keep it as a document.");
  if (inv.kind === "FLAT") throw new PermitIntelError(400, "This PDF has no fillable fields (it is a flat scan or a printed form). Filling flat forms is not supported yet; keep it on the permit as a document.");
  await checkMeta(meta);
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const same = await prisma.permitFormTemplate.findFirst({ where: { sha256, status: { not: "RETIRED" } }, select: { id: true, name: true } });
  if (same) throw new PermitIntelError(409, `This exact form is already a template: “${same.name}”.`);
  const stored = await saveFile(file.bytes, file.name);
  const t = await prisma.permitFormTemplate.create({
    data: {
      name: meta.name.trim(),
      jurisdictionId: meta.jurisdictionId ?? null,
      county: meta.county?.trim() || null,
      permitTypeKeys: meta.permitTypeKeys ?? [],
      notes: meta.notes ?? null,
      fileName: file.name,
      storageKey: stored.storageKey,
      sha256,
      sizeBytes: stored.bytes,
      pageCount: inv.pageCount,
      formKind: inv.kind,
      fieldInventory: inv.fields as unknown as Prisma.InputJsonValue,
      createdByUserId: actor.id,
    },
  });
  await audit(actor, t.id, "create", undefined, { name: t.name, fields: inv.fields.length, sha256 });
  return t;
}

async function checkMeta(meta: Partial<TemplateMeta>) {
  if (meta.jurisdictionId && !(await prisma.jurisdiction.findUnique({ where: { id: meta.jurisdictionId }, select: { id: true } }))) throw new PermitIntelError(400, "That jurisdiction does not exist");
  if (meta.permitTypeKeys?.length) {
    const n = await prisma.permitTypeDef.count({ where: { key: { in: meta.permitTypeKeys } } });
    if (n !== new Set(meta.permitTypeKeys).size) throw new PermitIntelError(400, "One of the permit types does not exist");
  }
}

export const inventoryOf = (t: { fieldInventory: unknown }) => t.fieldInventory as InventoryField[];

export async function loadTemplate(id: string) {
  const t = await prisma.permitFormTemplate.findUnique({
    where: { id },
    include: {
      fields: { select: { fieldName: true, dataKey: true, transform: true, aiSuggested: true, confidence: true, rationale: true } },
      jurisdiction: { select: { id: true, name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      publishedBy: { select: { firstName: true, lastName: true } },
      _count: { select: { fills: true } },
    },
  });
  if (!t) return null;
  const { storageKey: _k, ...rest } = t;
  void _k;
  return rest;
}

export async function listTemplates() {
  return prisma.permitFormTemplate.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }, { version: "desc" }],
    select: { id: true, name: true, version: true, status: true, county: true, permitTypeKeys: true, pageCount: true, fileName: true, mapState: true, publishedAt: true, createdAt: true, fieldInventory: true, jurisdiction: { select: { id: true, name: true } }, _count: { select: { fields: true, fills: true } } },
  }).then((rows) => rows.map(({ fieldInventory, ...r }) => ({ ...r, fieldCount: (fieldInventory as unknown[]).length })));
}

export async function updateTemplateMeta(id: string, meta: Partial<TemplateMeta>, actor: Actor) {
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!t) throw new PermitIntelError(404, "Form not found");
  await checkMeta(meta);
  const data: Prisma.PermitFormTemplateUncheckedUpdateInput = {};
  if (meta.name !== undefined) data.name = meta.name.trim();
  if (meta.jurisdictionId !== undefined) data.jurisdictionId = meta.jurisdictionId;
  if (meta.county !== undefined) data.county = meta.county?.trim() || null;
  if (meta.permitTypeKeys !== undefined) data.permitTypeKeys = meta.permitTypeKeys;
  if (meta.notes !== undefined) data.notes = meta.notes;
  // where a form is used is not part of how it is filled: it may change on a published form
  const u = await prisma.permitFormTemplate.update({ where: { id }, data });
  await audit(actor, id, "update", { name: t.name }, { name: u.name, jurisdictionId: u.jurisdictionId, county: u.county, permitTypeKeys: u.permitTypeKeys });
  return u;
}

export async function templateBytes(id: string) {
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, select: { storageKey: true, fileName: true } });
  if (!t) throw new PermitIntelError(404, "Form not found");
  try {
    return { bytes: await readFile(t.storageKey), fileName: t.fileName };
  } catch {
    throw new PermitIntelError(404, "The blank form is missing from the store");
  }
}

// ─── Mapping ────────────────────────────────────────────────────────────────

/** Ask for the AI's mapping; the reading runs after the answer (`runMapping`). */
export async function requestMapping(id: string, actor: Actor) {
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, select: { id: true, status: true, mapState: true, mapStartedAt: true } });
  if (!t) throw new PermitIntelError(404, "Form not found");
  if (t.status !== "DRAFT") throw new PermitIntelError(409, "A published form does not change. Edit it to start the next version.");
  if (t.mapState === "MAPPING" && t.mapStartedAt && Date.now() - t.mapStartedAt.getTime() < MAP_STALE_MS) throw new PermitIntelError(409, "The AI is mapping this form now");
  if (!isAiConfigured()) throw new AiError(AI_NOT_CONFIGURED, 503, "not_configured");
  await prisma.permitFormTemplate.update({ where: { id }, data: { mapState: "MAPPING", mapStartedAt: new Date(), mapError: null } });
  await audit(actor, id, "map_request");
}

/**
 * The AI maps every field. A field a person has already mapped by hand is
 * left as they set it; the AI's own earlier proposals are replaced. Never
 * throws: a failure is written on the template.
 */
export async function runMapping(id: string, userId: string | null): Promise<void> {
  try {
    const t = await prisma.permitFormTemplate.findUniqueOrThrow({ where: { id }, include: { fields: true } });
    if (t.mapState !== "MAPPING") return;
    const inv = inventoryOf(t);
    const r = await runAiCall({
      subjectType: "form_template",
      subjectId: id,
      purpose: formMap.PURPOSE,
      promptVersion: formMap.PROMPT_VERSION,
      schema: formMap.schema,
      inputs: { sha256: t.sha256, fields: inv.map((f) => [f.name, f.type, f.label, f.options ?? null]) },
      system: formMap.SYSTEM,
      content: formMap.content(inv),
      model: defaultModel(),
      effort: "medium",
      maxTokens: 32_000,
      userId,
    });
    const answers = new Map(r.output.fields.map((a) => [a.fieldName, a]));
    const byHand = new Set(t.fields.filter((f) => !f.aiSuggested && (f.dataKey || f.transform)).map((f) => f.fieldName));
    await prisma.$transaction(async (tx) => {
      for (const f of inv) {
        if (byHand.has(f.name)) continue;
        const a = answers.get(f.name);
        const ok = a ? acceptMapping(f, a) : { dataKey: null, transform: null, dropped: "The AI gave no answer for this field" };
        const rationale = (ok.dropped ? `Left blank: ${ok.dropped}.` : (a?.rationale ?? "")).slice(0, 300) || null;
        const data = { dataKey: ok.dataKey, transform: ok.transform, aiSuggested: true, confidence: a ? Math.min(1, Math.max(0, a.confidence)) : null, rationale };
        await tx.permitFormFieldMap.upsert({ where: { templateId_fieldName: { templateId: id, fieldName: f.name } }, create: { templateId: id, fieldName: f.name, ...data }, update: data });
      }
      await tx.permitFormTemplate.update({ where: { id }, data: { mapState: "IDLE", mapError: null, aiCallId: r.callId } });
    });
  } catch (err) {
    const message = err instanceof AiError ? err.message : "The form could not be mapped. Try again, or map it by hand.";
    if (!(err instanceof AiError)) logger.exception(err, { where: "forms.runMapping", templateId: id });
    await prisma.permitFormTemplate.update({ where: { id }, data: { mapState: "FAILED", mapError: message.slice(0, 500) } }).catch(() => undefined);
  }
}

/** A reading left MAPPING by a restart is retried by the next page load. */
export function mappingIsStale(t: { mapState: string; mapStartedAt: Date | null }): boolean {
  return t.mapState === "MAPPING" && (!t.mapStartedAt || Date.now() - t.mapStartedAt.getTime() > MAP_STALE_MS);
}

/** A person's mapping for some fields (a draft only). Each is checked against the field it is for. */
export async function saveMappings(id: string, rows: FieldMap[], actor: Actor) {
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, select: { id: true, status: true, fieldInventory: true } });
  if (!t) throw new PermitIntelError(404, "Form not found");
  if (t.status !== "DRAFT") throw new PermitIntelError(409, "A published form does not change. Edit it to start the next version.");
  const inv = new Map(inventoryOf(t).map((f) => [f.name, f]));
  const problems: string[] = [];
  for (const r of rows) {
    const f = inv.get(r.fieldName);
    if (!f) problems.push(`${r.fieldName}: not a field of this form`);
    else {
      const p = mappingProblem(f, r.dataKey, r.transform);
      if (p) problems.push(`${f.label ?? f.name}: ${p}`);
    }
  }
  if (problems.length) throw new PermitIntelError(400, problems.slice(0, 5).join("; "));
  await prisma.$transaction(
    rows.map((r) => {
      const data = { dataKey: r.dataKey?.trim() || null, transform: r.transform?.trim() || null, aiSuggested: false, confidence: null, rationale: null };
      return prisma.permitFormFieldMap.upsert({ where: { templateId_fieldName: { templateId: id, fieldName: r.fieldName } }, create: { templateId: id, fieldName: r.fieldName, ...data }, update: data });
    }),
  );
  await audit(actor, id, "map_edit", undefined, { fields: rows.map((r) => ({ field: r.fieldName, dataKey: r.dataKey, transform: r.transform })) });
}

// ─── Publishing and versions ────────────────────────────────────────────────

export async function publishTemplate(id: string, actor: Actor) {
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, select: { id: true, status: true, sha256: true, mapState: true, version: true, _count: { select: { fields: true } } } });
  if (!t) throw new PermitIntelError(404, "Form not found");
  if (t.status !== "DRAFT") throw new PermitIntelError(409, "Only a draft is published");
  if (t.mapState === "MAPPING") throw new PermitIntelError(409, "Wait for the AI's mapping to finish");
  const mapped = await prisma.permitFormFieldMap.count({ where: { templateId: id, dataKey: { not: null } } });
  if (!mapped) throw new PermitIntelError(400, "Map at least one field before publishing");
  await prisma.$transaction([
    prisma.permitFormTemplate.updateMany({ where: { sha256: t.sha256, status: "PUBLISHED", id: { not: id } }, data: { status: "RETIRED" } }),
    prisma.permitFormTemplate.update({ where: { id }, data: { status: "PUBLISHED", publishedByUserId: actor.id, publishedAt: new Date() } }),
  ]);
  await audit(actor, id, "publish", undefined, { version: t.version, mappedFields: mapped });
}

export async function retireTemplate(id: string, actor: Actor) {
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!t) throw new PermitIntelError(404, "Form not found");
  await prisma.permitFormTemplate.update({ where: { id }, data: { status: "RETIRED" } });
  await audit(actor, id, "retire", { status: t.status });
}

/** The next version of a published form: the same file and mapping, as a draft to edit. */
export async function reviseTemplate(id: string, actor: Actor) {
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, include: { fields: true } });
  if (!t) throw new PermitIntelError(404, "Form not found");
  const draft = await prisma.permitFormTemplate.findFirst({ where: { sha256: t.sha256, status: "DRAFT" }, select: { id: true } });
  if (draft) return prisma.permitFormTemplate.findUniqueOrThrow({ where: { id: draft.id } });
  const top = await prisma.permitFormTemplate.aggregate({ where: { sha256: t.sha256 }, _max: { version: true } });
  const next = await prisma.permitFormTemplate.create({
    data: {
      name: t.name,
      jurisdictionId: t.jurisdictionId,
      county: t.county,
      permitTypeKeys: t.permitTypeKeys,
      notes: t.notes,
      fileName: t.fileName,
      storageKey: t.storageKey,
      sha256: t.sha256,
      version: (top._max.version ?? t.version) + 1,
      sizeBytes: t.sizeBytes,
      pageCount: t.pageCount,
      formKind: t.formKind,
      fieldInventory: t.fieldInventory as Prisma.InputJsonValue,
      createdByUserId: actor.id,
      fields: { create: t.fields.map((f) => ({ fieldName: f.fieldName, dataKey: f.dataKey, transform: f.transform, aiSuggested: f.aiSuggested, confidence: f.confidence, rationale: f.rationale })) },
    },
  });
  await audit(actor, next.id, "revise", undefined, { from: id, version: next.version });
  return next;
}

/** The published forms that apply to a permit: its jurisdiction's, or its county's, for its type. */
export async function templatesForPermit(permit: { jurisdictionId: string | null; permitTypeKey: string | null; county: string | null }) {
  const rows = await prisma.permitFormTemplate.findMany({
    where: {
      status: "PUBLISHED",
      OR: [
        ...(permit.jurisdictionId ? [{ jurisdictionId: permit.jurisdictionId }] : []),
        { jurisdictionId: null, county: null },
        ...(permit.county ? [{ jurisdictionId: null, county: { equals: permit.county, mode: "insensitive" as const } }] : []),
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, version: true, jurisdictionId: true, county: true, permitTypeKeys: true, pageCount: true },
  });
  return rows.filter((t) => !t.permitTypeKeys.length || (permit.permitTypeKey && t.permitTypeKeys.includes(permit.permitTypeKey)));
}

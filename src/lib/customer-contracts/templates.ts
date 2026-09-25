// Contract template versioning: a PUBLISHED version is immutable (contracts
// pin it); editing means creating a DRAFT copy, changing it, validating and
// publishing, which supersedes the previous version. Mirrors the workflow
// template editor so the two behave alike.

import type { Prisma, PrismaClient, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { normaliseTemplateContent, parseTemplateContent, templateContentHash, validateTemplateContent } from "./template-content";
import type { ContractTemplateContent } from "./types";

export { parseTemplateContent, templateContentHash, validateTemplateContent } from "./template-content";

type Db = PrismaClient | Prisma.TransactionClient;
type Actor = { id: string; role: RoleName };

export class TemplateVersioningError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = "TemplateVersioningError";
  }
}

function contentData(c: ContractTemplateContent) {
  const n = normaliseTemplateContent(c);
  return {
    title: n.title,
    articles: n.articles as unknown as Prisma.InputJsonValue,
    paymentSchedule: n.paymentSchedule as unknown as Prisma.InputJsonValue,
    paymentScheduleText: n.paymentScheduleText,
    consentText: n.consentText,
    contentHash: templateContentHash(n),
  };
}

const VERSION_SELECT = {
  id: true,
  templateId: true,
  version: true,
  status: true,
  title: true,
  articles: true,
  paymentSchedule: true,
  paymentScheduleText: true,
  consentText: true,
  changeNotes: true,
  contentHash: true,
  sourceVersionId: true,
  publishedAt: true,
  supersededAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  publishedBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { contracts: true } },
} satisfies Prisma.ContractTemplateVersionSelect;

export async function listTemplates() {
  return prisma.contractTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: {
      versions: {
        orderBy: { version: "desc" },
        select: { id: true, version: true, status: true, publishedAt: true, updatedAt: true, _count: { select: { contracts: true } } },
      },
    },
  });
}

export async function getTemplate(templateId: string) {
  const t = await prisma.contractTemplate.findUnique({
    where: { id: templateId },
    include: { versions: { orderBy: { version: "desc" }, select: VERSION_SELECT } },
  });
  if (!t) throw new TemplateVersioningError(404, "Template not found");
  return t;
}

export async function getVersion(versionId: string) {
  const v = await prisma.contractTemplateVersion.findUnique({ where: { id: versionId }, select: { ...VERSION_SELECT, template: { select: { id: true, key: true, name: true, isDefault: true } } } });
  if (!v) throw new TemplateVersioningError(404, "Version not found");
  return v;
}

/** The published version new contracts are generated from. */
export async function getPublishedVersion(templateKey?: string | null) {
  const template = templateKey
    ? await prisma.contractTemplate.findUnique({ where: { key: templateKey } })
    : await prisma.contractTemplate.findFirst({ where: { isDefault: true, isActive: true } });
  if (!template) throw new TemplateVersioningError(404, templateKey ? `Template "${templateKey}" not found` : "No default contract template — publish one under Admin → Contract Templates");
  const v = await prisma.contractTemplateVersion.findFirst({
    where: { templateId: template.id, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (!v) throw new TemplateVersioningError(409, `${template.name} has no published version`);
  return { template, version: v, content: parseTemplateContent(v) };
}

export async function listPublishedTemplates() {
  const rows = await prisma.contractTemplate.findMany({
    where: { isActive: true, versions: { some: { status: "PUBLISHED" } } },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { versions: { where: { status: "PUBLISHED" }, orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, title: true } } },
  });
  return rows.map((t) => ({ id: t.id, key: t.key, name: t.name, description: t.description, isDefault: t.isDefault, published: t.versions[0] ?? null }));
}

export async function createTemplate(meta: { key: string; name: string; description?: string | null }, actor: Actor) {
  const key = meta.key.trim();
  if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new TemplateVersioningError(400, "Key must be lowercase letters, digits and underscores");
  if (!meta.name.trim()) throw new TemplateVersioningError(400, "Name is required");
  const existing = await prisma.contractTemplate.findUnique({ where: { key } });
  if (existing) throw new TemplateVersioningError(409, `A template with key "${key}" already exists`);
  const count = await prisma.contractTemplate.count();
  const t = await prisma.contractTemplate.create({ data: { key, name: meta.name.trim(), description: meta.description?.trim() || null, isDefault: count === 0 } });
  await recordAudit({ actorUserId: actor.id, entityType: "ContractTemplate", entityId: t.id, action: "create", after: { key, name: t.name } });
  return t;
}

export async function updateTemplateMeta(templateId: string, meta: { name?: string; description?: string | null; isActive?: boolean }, actor: Actor) {
  const before = await prisma.contractTemplate.findUnique({ where: { id: templateId } });
  if (!before) throw new TemplateVersioningError(404, "Template not found");
  if (meta.name !== undefined && !meta.name.trim()) throw new TemplateVersioningError(400, "Name is required");
  if (meta.isActive === false && before.isDefault) throw new TemplateVersioningError(409, "The default template cannot be deactivated — set another default first");
  const t = await prisma.contractTemplate.update({
    where: { id: templateId },
    data: { name: meta.name?.trim(), description: meta.description === undefined ? undefined : meta.description?.trim() || null, isActive: meta.isActive },
  });
  await recordAudit({ actorUserId: actor.id, entityType: "ContractTemplate", entityId: t.id, action: "update", before: { name: before.name, description: before.description, isActive: before.isActive }, after: meta });
  return t;
}

export async function setDefaultTemplate(templateId: string, actor: Actor) {
  const t = await prisma.contractTemplate.findUnique({ where: { id: templateId }, include: { versions: { where: { status: "PUBLISHED" }, select: { id: true } } } });
  if (!t) throw new TemplateVersioningError(404, "Template not found");
  if (!t.isActive) throw new TemplateVersioningError(409, "An inactive template cannot be the default");
  if (t.versions.length === 0) throw new TemplateVersioningError(409, "Publish a version before making this template the default");
  await prisma.$transaction([
    prisma.contractTemplate.updateMany({ where: { isDefault: true, id: { not: templateId } }, data: { isDefault: false } }),
    prisma.contractTemplate.update({ where: { id: templateId }, data: { isDefault: true } }),
  ]);
  await recordAudit({ actorUserId: actor.id, entityType: "ContractTemplate", entityId: templateId, action: "set_default" });
}

/** A new DRAFT copied from the current published version (or from `fromVersionId`). */
export async function createDraftVersion(templateId: string, actor: Actor, fromVersionId?: string | null) {
  const template = await prisma.contractTemplate.findUnique({ where: { id: templateId }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!template) throw new TemplateVersioningError(404, "Template not found");
  const openDraft = template.versions.find((v) => v.status === "DRAFT");
  if (openDraft) throw new TemplateVersioningError(409, `v${openDraft.version} is already a draft — edit or publish it first`);
  const source = fromVersionId ? template.versions.find((v) => v.id === fromVersionId) : template.versions.find((v) => v.status === "PUBLISHED") ?? template.versions[0];
  const nextVersion = (template.versions[0]?.version ?? 0) + 1;
  const content: ContractTemplateContent = source
    ? parseTemplateContent(source)
    : { title: template.name, articles: [], paymentSchedule: { items: [] }, paymentScheduleText: "", consentText: "" };
  const v = await prisma.contractTemplateVersion.create({
    data: { templateId, version: nextVersion, status: "DRAFT", ...contentData(content), sourceVersionId: source?.id ?? null, createdByUserId: actor.id },
    select: VERSION_SELECT,
  });
  await recordAudit({ actorUserId: actor.id, entityType: "ContractTemplateVersion", entityId: v.id, action: "create", after: { templateId, version: nextVersion, from: source?.version ?? null } });
  return v;
}

export async function updateDraftVersion(versionId: string, content: ContractTemplateContent, actor: Actor) {
  const v = await prisma.contractTemplateVersion.findUnique({ where: { id: versionId }, select: { id: true, version: true, status: true, contentHash: true } });
  if (!v) throw new TemplateVersioningError(404, "Version not found");
  if (v.status !== "DRAFT") throw new TemplateVersioningError(409, `v${v.version} is ${v.status.toLowerCase()} — create a draft to change it`);
  const updated = await prisma.contractTemplateVersion.update({ where: { id: versionId }, data: contentData(content), select: VERSION_SELECT });
  await recordAudit({ actorUserId: actor.id, entityType: "ContractTemplateVersion", entityId: versionId, action: "update", before: { contentHash: v.contentHash }, after: { contentHash: updated.contentHash } });
  return updated;
}

export async function publishVersion(versionId: string, actor: Actor, changeNotes?: string | null) {
  const v = await prisma.contractTemplateVersion.findUnique({ where: { id: versionId } });
  if (!v) throw new TemplateVersioningError(404, "Version not found");
  if (v.status !== "DRAFT") throw new TemplateVersioningError(409, `v${v.version} is already ${v.status.toLowerCase()}`);
  const errors = validateTemplateContent(parseTemplateContent(v));
  if (errors.length > 0) throw new TemplateVersioningError(400, "The draft has problems that block publishing", errors);
  const now = new Date();
  const [, published] = await prisma.$transaction([
    prisma.contractTemplateVersion.updateMany({ where: { templateId: v.templateId, status: "PUBLISHED" }, data: { status: "SUPERSEDED", supersededAt: now } }),
    prisma.contractTemplateVersion.update({
      where: { id: versionId },
      data: { status: "PUBLISHED", publishedAt: now, publishedByUserId: actor.id, changeNotes: changeNotes?.trim() || v.changeNotes },
      select: VERSION_SELECT,
    }),
  ]);
  await recordAudit({ actorUserId: actor.id, entityType: "ContractTemplateVersion", entityId: versionId, action: "publish", after: { version: v.version, changeNotes } });
  return published;
}

export async function archiveVersion(versionId: string, actor: Actor) {
  const v = await prisma.contractTemplateVersion.findUnique({ where: { id: versionId }, include: { template: { select: { isDefault: true } } } });
  if (!v) throw new TemplateVersioningError(404, "Version not found");
  if (v.status === "PUBLISHED" && v.template.isDefault) throw new TemplateVersioningError(409, "This is the default template's published version — publish a replacement first");
  if (v.status === "ARCHIVED") return v;
  const updated = await prisma.contractTemplateVersion.update({ where: { id: versionId }, data: { status: "ARCHIVED" }, select: VERSION_SELECT });
  await recordAudit({ actorUserId: actor.id, entityType: "ContractTemplateVersion", entityId: versionId, action: "archive", before: { status: v.status } });
  return updated;
}

// ─── Seeding ────────────────────────────────────────────────────────────────

export type SeedOutcome = "created" | "unchanged" | "updated";

export class SeedVersionInUseError extends Error {
  constructor(key: string, version: number, contracts: number) {
    super(`${key} v${version} is pinned by ${contracts} contract${contracts === 1 ? "" : "s"}; bump CONTRACT_TEMPLATE_VERSION instead of editing v${version}`);
    this.name = "SeedVersionInUseError";
  }
}

/**
 * Idempotent. Unchanged hash → no-op. Changed content on a version no
 * contract references → update in place. Changed content on a version a
 * contract pins → throw: bump the version in the spec file.
 */
export async function upsertContractTemplateVersion(
  db: Db,
  def: { key: string; name: string; description?: string | null; content: ContractTemplateContent; isDefault?: boolean },
  opts: { version: number; log?: (line: string) => void },
): Promise<{ outcome: SeedOutcome; versionId: string }> {
  const log = opts.log ?? (() => {});
  const errors = validateTemplateContent(def.content);
  if (errors.length > 0) throw new Error(`Seed spec ${def.key} is invalid: ${errors.join("; ")}`);
  const hash = templateContentHash(def.content);

  const template = await db.contractTemplate.upsert({
    where: { key: def.key },
    create: { key: def.key, name: def.name, description: def.description ?? null, isDefault: def.isDefault ?? false, isActive: true },
    update: { name: def.name, description: def.description ?? null, isActive: true },
  });
  if (def.isDefault) {
    const anyDefault = await db.contractTemplate.count({ where: { isDefault: true } });
    if (anyDefault === 0) await db.contractTemplate.update({ where: { id: template.id }, data: { isDefault: true } });
  }

  const existing = await db.contractTemplateVersion.findUnique({
    where: { templateId_version: { templateId: template.id, version: opts.version } },
    select: { id: true, contentHash: true, _count: { select: { contracts: true } } },
  });
  if (existing && existing.contentHash === hash) {
    log(`  ${def.key} v${opts.version}: unchanged`);
    return { outcome: "unchanged", versionId: existing.id };
  }
  if (existing && existing._count.contracts > 0) throw new SeedVersionInUseError(def.key, opts.version, existing._count.contracts);

  if (existing) {
    await db.contractTemplateVersion.update({ where: { id: existing.id }, data: contentData(def.content) });
    log(`  ${def.key} v${opts.version}: updated`);
    return { outcome: "updated", versionId: existing.id };
  }
  const now = new Date();
  const [, created] = await Promise.all([
    db.contractTemplateVersion.updateMany({ where: { templateId: template.id, status: "PUBLISHED" }, data: { status: "SUPERSEDED", supersededAt: now } }),
    db.contractTemplateVersion.create({
      data: { templateId: template.id, version: opts.version, status: "PUBLISHED", publishedAt: now, changeNotes: "Seeded", ...contentData(def.content) },
      select: { id: true },
    }),
  ]);
  log(`  ${def.key} v${opts.version}: created`);
  return { outcome: "created", versionId: created.id };
}

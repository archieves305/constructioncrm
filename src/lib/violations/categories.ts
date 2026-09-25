import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { slugKey } from "@/lib/workflows/slug";
import { auditCase } from "./audit";
import { ViolationError } from "./errors";

type Actor = { id: string; role: RoleName };

export async function listCategories(opts: { includeInactive?: boolean } = {}) {
  return prisma.codeViolationCategory.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });
}

export async function createCategory(body: { key?: string; name: string; description?: string | null; defaultResponsibleTrade?: string | null; defaultPermitRequirement?: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED"; defaultConstructionRequired?: boolean; sortOrder?: number; isActive?: boolean }, actor: Actor) {
  const key = body.key ?? slugKey(body.name);
  if (await prisma.codeViolationCategory.findUnique({ where: { key } })) throw new ViolationError(409, `A category with key "${key}" already exists`);
  const last = await prisma.codeViolationCategory.aggregate({ _max: { sortOrder: true } });
  const row = await prisma.codeViolationCategory.create({
    data: { key, name: body.name, description: body.description ?? null, defaultResponsibleTrade: body.defaultResponsibleTrade ?? null, defaultPermitRequirement: body.defaultPermitRequirement ?? "UNDETERMINED", defaultConstructionRequired: body.defaultConstructionRequired ?? false, sortOrder: body.sortOrder ?? (last._max.sortOrder ?? 0) + 10, isActive: body.isActive ?? true },
  });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCategory", entityId: row.id, action: "violation_category_create", after: { key, name: body.name } });
  return row;
}

export async function updateCategory(id: string, body: Partial<{ name: string; description: string | null; defaultResponsibleTrade: string | null; defaultPermitRequirement: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED"; defaultConstructionRequired: boolean; sortOrder: number; isActive: boolean }>, actor: Actor) {
  const before = await prisma.codeViolationCategory.findUnique({ where: { id } });
  if (!before) throw new ViolationError(404, "Category not found");
  const data: Prisma.CodeViolationCategoryUpdateInput = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
  const row = await prisma.codeViolationCategory.update({ where: { id }, data });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCategory", entityId: id, action: "violation_category_update", before: { name: before.name, isActive: before.isActive, sortOrder: before.sortOrder }, after: { ...body } });
  return row;
}

/** A category with items is deactivated rather than deleted, so history keeps its label. */
export async function deleteCategory(id: string, actor: Actor) {
  const c = await prisma.codeViolationCategory.findUnique({ where: { id }, select: { key: true, name: true, _count: { select: { items: true } } } });
  if (!c) throw new ViolationError(404, "Category not found");
  if (c._count.items > 0) {
    await prisma.codeViolationCategory.update({ where: { id }, data: { isActive: false } });
    await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCategory", entityId: id, action: "violation_category_update", after: { isActive: false, note: `${c._count.items} items reference it; deactivated instead of deleted` } });
    return { deleted: false, deactivated: true };
  }
  await prisma.codeViolationCategory.delete({ where: { id } });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCategory", entityId: id, action: "violation_category_delete", before: { key: c.key, name: c.name } });
  return { deleted: true, deactivated: false };
}

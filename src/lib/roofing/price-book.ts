/**
 * The roofing price book and takeoff rules: the database side. What a rule
 * set or a catalog means is decided in `engine/resolve.ts`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { DEFAULT_RULES } from "./engine/defaults";
import { generateEstimate, type EstimateOptions } from "./engine/engine";
import { priceAgeDays, priceInForce, pricedCatalog, resolveRules, ruleRows, STALE_PRICE_DAYS, type CatalogItem } from "./engine/resolve";
import { MEASUREMENT_KEYS, toEngineMeasurements, type MeasurementValues } from "./measurements";
import type { RoofType } from "./types";
import { dayKey } from "@/lib/time/zone";

/** Today in the office's zone, and that day as a stored price date (noon UTC). */
const today = () => dayKey(new Date());
export const priceDate = (day: string) => new Date(`${day}T12:00:00Z`);

const ITEM_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  prices: { orderBy: { effectiveDate: "desc" as const }, select: { id: true, unitCost: true, effectiveDate: true, source: true, note: true, createdAt: true, createdBy: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.RoofMaterialItemInclude;

type ItemRow = Prisma.RoofMaterialItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

function presentItem(row: ItemRow, asOf: string) {
  const prices = row.prices.map((p) => ({ ...p, unitCost: Number(p.unitCost) }));
  const current = priceInForce(prices, asOf);
  const age = priceAgeDays(current, asOf);
  return {
    ...row,
    prices,
    currentPrice: current ? { unitCost: current.unitCost, effectiveDate: current.effectiveDate, ageDays: age, stale: age !== null && age > STALE_PRICE_DAYS } : null,
  };
}

export async function listMaterials() {
  const rows = await prisma.roofMaterialItem.findMany({ include: ITEM_INCLUDE, orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }] });
  const now = today();
  return rows.map((r) => presentItem(r, now));
}

export type MaterialInput = { category: string; name: string; sku?: string | null; roofType?: RoofType | null; unitType: string; vendorId?: string | null; isPreferred?: boolean; isActive?: boolean; notes?: string | null };

/** Only one item is the takeoff's choice for a category and roof type. */
async function clearOtherPreferred(tx: Prisma.TransactionClient, item: { id: string; category: string; roofType: string | null }) {
  await tx.roofMaterialItem.updateMany({ where: { category: item.category, roofType: item.roofType, isPreferred: true, id: { not: item.id } }, data: { isPreferred: false } });
}

export async function createMaterial(input: MaterialInput & { unitCost?: number | null }, userId: string) {
  const row = await prisma.$transaction(async (tx) => {
    const { unitCost, ...data } = input;
    const item = await tx.roofMaterialItem.create({ data });
    if (item.isPreferred) await clearOtherPreferred(tx, item);
    if (unitCost != null) await tx.roofMaterialPrice.create({ data: { materialItemId: item.id, unitCost, effectiveDate: priceDate(today()), source: "manual", createdByUserId: userId } });
    return tx.roofMaterialItem.findUniqueOrThrow({ where: { id: item.id }, include: ITEM_INCLUDE });
  });
  await recordAudit({ actorUserId: userId, entityType: "roof_material", entityId: row.id, action: "create", after: input });
  return presentItem(row, today());
}

export async function updateMaterial(id: string, input: Partial<MaterialInput>, userId: string) {
  const before = await prisma.roofMaterialItem.findUnique({ where: { id } });
  if (!before) return null;
  const row = await prisma.$transaction(async (tx) => {
    const item = await tx.roofMaterialItem.update({ where: { id }, data: input });
    if (item.isPreferred) await clearOtherPreferred(tx, item);
    return tx.roofMaterialItem.findUniqueOrThrow({ where: { id }, include: ITEM_INCLUDE });
  });
  await recordAudit({ actorUserId: userId, entityType: "roof_material", entityId: id, action: "update", before, after: input });
  return presentItem(row, today());
}

/** A new price from a date. Earlier prices are never changed: they are the history. */
export async function addPrice(materialItemId: string, input: { unitCost: number; day?: string; note?: string | null; source?: string }, userId: string) {
  const effectiveDate = priceDate(input.day ?? today());
  const item = await prisma.roofMaterialItem.findUnique({ where: { id: materialItemId }, select: { id: true } });
  if (!item) return null;
  const price = await prisma.roofMaterialPrice.create({ data: { materialItemId, unitCost: input.unitCost, effectiveDate, note: input.note ?? null, source: input.source ?? "manual", createdByUserId: userId } });
  await recordAudit({ actorUserId: userId, entityType: "roof_material", entityId: materialItemId, action: "price_add", after: { unitCost: input.unitCost, effectiveDate, priceId: price.id } });
  const row = await prisma.roofMaterialItem.findUniqueOrThrow({ where: { id: materialItemId }, include: ITEM_INCLUDE });
  return presentItem(row, today());
}

export async function listRules() {
  const overrides = await prisma.roofRule.findMany({ include: { updatedBy: { select: { firstName: true, lastName: true } } } });
  const meta = new Map(overrides.map((o) => [o.key, o]));
  return ruleRows(overrides).map((r) => {
    const o = meta.get(r.key);
    return { ...r, note: o?.note ?? null, updatedAt: o?.updatedAt ?? null, updatedBy: o?.updatedBy ?? null };
  });
}

export function ruleDef(key: string) {
  return DEFAULT_RULES.find((d) => d.key === key) ?? null;
}

export async function setRule(key: string, input: { value: number; active: boolean; note?: string | null }, userId: string) {
  const before = await prisma.roofRule.findUnique({ where: { key }, select: { value: true, active: true } });
  await prisma.roofRule.upsert({ where: { key }, create: { key, value: input.value, active: input.active, note: input.note ?? null, updatedByUserId: userId }, update: { value: input.value, active: input.active, note: input.note ?? null, updatedByUserId: userId } });
  await recordAudit({ actorUserId: userId, entityType: "roof_rule", entityId: key, action: "update", before: before ?? { value: ruleDef(key)?.value, active: true }, after: { value: input.value, active: input.active } });
}

/** Back to the rule as written in the code. */
export async function resetRule(key: string, userId: string) {
  const before = await prisma.roofRule.findUnique({ where: { key }, select: { value: true, active: true } });
  if (!before) return;
  await prisma.roofRule.delete({ where: { key } });
  await recordAudit({ actorUserId: userId, entityType: "roof_rule", entityId: key, action: "reset", before, after: { value: ruleDef(key)?.value, active: true } });
}

/** What the engine needs for one roof type, as of now. */
export async function loadEngineInputs(roofType: RoofType, asOf: string = today()) {
  const [overrides, items] = await Promise.all([
    prisma.roofRule.findMany({ select: { key: true, value: true, active: true } }),
    prisma.roofMaterialItem.findMany({ where: { isActive: true }, include: { prices: { select: { unitCost: true, effectiveDate: true, createdAt: true } } } }),
  ]);
  const catalog: CatalogItem[] = items.map((i) => ({ ...i, prices: i.prices.map((p) => ({ unitCost: Number(p.unitCost), effectiveDate: p.effectiveDate, createdAt: p.createdAt })) }));
  return { rules: resolveRules(roofType, overrides), materials: pricedCatalog(catalog, roofType, asOf) };
}

/** Run the takeoff on a stored measurement with today's rules and prices. Writes nothing. */
export async function previewTakeoff(measurementId: string, roofType: RoofType, options: EstimateOptions = {}) {
  const m = await prisma.roofMeasurement.findUnique({ where: { id: measurementId } });
  if (!m) return null;
  const values: Record<string, unknown> = {};
  for (const k of MEASUREMENT_KEYS) values[k] = m[k];
  const { rules, materials } = await loadEngineInputs(roofType);
  const result = generateEstimate(roofType, toEngineMeasurements({ ...(values as MeasurementValues), pitchBands: m.pitchBands }), rules, materials, { parseConfidence: m.parseConfidence ?? undefined, ...options });
  return { ...result, reportWastePct: m.reportWastePct };
}

/**
 * Import the roofing estimator's data into the CRM (2026-10, one-off).
 *
 * Source: the estimator's own database (roofing.careyos.com), read-only —
 * this script never writes there. Target: this CRM.
 *
 *   Materials + prices → the roofing price book (source "import"; a supplier
 *                        is linked only when a vendor of the same name exists)
 *   Takeoff rules      → a saved change only where the estimator's number
 *                        differs from this app's rule, or the rule is off
 *   Roofr reports      → the PDF is read again by this app and stored as a
 *                        measurement on the lead at the same address; values a
 *                        person had typed over the estimator's reading are
 *                        carried across as corrections
 *
 * A property is matched to a lead by street + zip (lib/roofing/import-plan.ts).
 * Unmatched and ambiguous properties are listed and left for a person.
 * Material lists and supplier invoices are counted, not imported: the CRM has
 * nowhere for them until the estimate builder exists.
 *
 * Dry run by default (reads both databases, writes nothing); `--yes` applies.
 * Idempotent: a second run creates nothing.
 *
 *   ROOF_SOURCE_DATABASE_URL  the estimator's DATABASE_URL
 *   ROOF_SOURCE_STORAGE_DIR   the estimator's STORAGE_DIR
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { prisma } from "../src/lib/db/prisma";
import { manualOverrides, matchProperty, measurementDifferences, planMaterials, planRuleChanges, type SourceProperty } from "../src/lib/roofing/import-plan";
import { MEASUREMENT_KEYS, valueProblem, type MeasurementKey, type MeasurementValues } from "../src/lib/roofing/measurements";
import { parseRoofrPdf } from "../src/lib/roofing/parsing/roofr";
import { priceDate, setRule } from "../src/lib/roofing/price-book";
import { createFromReport, updateMeasurement } from "../src/lib/roofing/service";

type Row = Record<string, unknown>;

async function main() {
  const apply = process.argv.includes("--yes");
  const sourceUrl = process.env.ROOF_SOURCE_DATABASE_URL;
  const storageDir = process.env.ROOF_SOURCE_STORAGE_DIR;
  if (!sourceUrl || !storageDir) throw new Error("Set ROOF_SOURCE_DATABASE_URL and ROOF_SOURCE_STORAGE_DIR");

  const src = new Client({ connectionString: sourceUrl.replace(/\?.*$/, "") });
  await src.connect();
  await src.query("SET default_transaction_read_only = on");
  const q = async (sql: string) => (await src.query(sql)).rows as Row[];

  const actor = await prisma.user.findFirst({ where: { role: { name: "ADMIN" }, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });
  if (!actor) throw new Error("No active admin to record the import under");
  console.log(`${apply ? "APPLYING" : "DRY RUN — nothing will be written"} · recorded under ${actor.email}\n`);

  // ── Materials and prices ────────────────────────────────────────────────
  const materials = await q(`select m.id, m.category, m.name, m.sku, m."roofType"::text as "roofType", m."unitType", m.active, m.notes, s.name as supplier from material_items m left join supplier_profiles s on s.id = m."supplierProfileId" order by m.category, m.name`);
  const prices = await q(`select "materialItemId", "unitCost", "effectiveDate", notes from material_prices where active = true order by "effectiveDate"`);
  const existing = await prisma.roofMaterialItem.findMany({ select: { category: true, name: true, roofType: true } });
  const vendors = await prisma.vendor.findMany({ select: { id: true, name: true } });
  const vendorByName = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v.id]));
  const plan = planMaterials(materials as { id: string; category: string; name: string; roofType: string | null }[], existing);
  const suppliersUnlinked = new Set<string>();
  let pricesCreated = 0;
  for (const m of plan.toCreate as Row[]) {
    const supplier = (m.supplier as string | null)?.trim() ?? null;
    const vendorId = supplier ? (vendorByName.get(supplier.toLowerCase()) ?? null) : null;
    if (supplier && !vendorId) suppliersUnlinked.add(supplier);
    const own = prices.filter((p) => p.materialItemId === m.id);
    pricesCreated += own.length;
    if (!apply) continue;
    await prisma.roofMaterialItem.create({
      data: {
        category: m.category as string, name: m.name as string, sku: (m.sku as string | null) ?? null, roofType: (m.roofType as string | null) ?? null, unitType: m.unitType as string,
        isActive: m.active as boolean, notes: (m.notes as string | null) ?? null, vendorId,
        prices: { create: own.map((p) => ({ unitCost: Number(p.unitCost), effectiveDate: priceDate((p.effectiveDate as Date).toISOString().slice(0, 10)), source: "import", note: (p.notes as string | null) ?? "Imported from the roofing estimator", createdByUserId: actor.id })) },
      },
    });
  }
  console.log(`Materials: ${materials.length} in the estimator · ${plan.toCreate.length} ${apply ? "created" : "to create"} with ${pricesCreated} price(s) · ${plan.already.length} already here`);
  if (suppliersUnlinked.size) console.log(`  No vendor of that name, supplier left blank: ${[...suppliersUnlinked].join(", ")}`);

  // ── Rules ───────────────────────────────────────────────────────────────
  const rules = await q(`select key, value, active from estimate_rules`);
  const rulePlan = planRuleChanges(rules as { key: string; value: number | null; active: boolean }[]);
  const saved = new Map((await prisma.roofRule.findMany({ select: { key: true, value: true, active: true } })).map((r) => [r.key, r]));
  const ruleWrites = rulePlan.changes.filter((c) => { const s = saved.get(c.key); return !s || s.value !== c.value || s.active !== c.active; });
  if (apply) for (const c of ruleWrites) await setRule(c.key, { value: c.value, active: c.active, note: "Imported from the roofing estimator" }, actor.id);
  console.log(`\nRules: ${rules.length} in the estimator · ${rulePlan.changes.length} differ from this app's rules · ${ruleWrites.length} ${apply ? "saved" : "to save"}`);
  for (const c of rulePlan.changes) console.log(`  ${c.key}: ${c.active ? c.value : "switched off"} (this app: ${c.defaultValue})`);
  if (rulePlan.unknown.length) console.log(`  Not in this app, ignored: ${rulePlan.unknown.join(", ")}`);

  // ── Roofr reports → measurements ────────────────────────────────────────
  const reports = await q(`select r.id, r."propertyId", p."addressLine1", p.city, p.state, p."postalCode", p."customerName" from roofr_reports r left join properties p on p.id = r."propertyId" order by r."createdAt"`);
  const files = await q(`select "roofrReportId", "originalName", "storagePath", "mimeType" from uploaded_files where "roofrReportId" is not null order by "createdAt"`);
  const stored = await q(`select * from parsed_measurements`);
  const leads = await prisma.lead.findMany({ select: { id: true, propertyAddress1: true, city: true, zipCode: true, fullName: true } });
  let created = 0, skipped = 0, held = 0;
  console.log(`\nRoofr reports: ${reports.length} in the estimator`);
  for (const r of reports) {
    const where = [r.addressLine1, r.city, r.postalCode].filter(Boolean).join(", ") || "(no property)";
    const file = files.find((f) => f.roofrReportId === r.id && (f.mimeType === "application/pdf" || String(f.originalName).toLowerCase().endsWith(".pdf")));
    if (!r.propertyId || !r.addressLine1) { held++; console.log(`  HELD  ${where}: the report has no property`); continue; }
    const match = matchProperty({ id: r.propertyId as string, addressLine1: r.addressLine1 as string, city: r.city as string | null, state: r.state as string | null, postalCode: r.postalCode as string | null } satisfies SourceProperty, leads);
    if (match.status !== "matched") { held++; console.log(`  HELD  ${where}${r.customerName ? ` (${r.customerName})` : ""}: ${match.status === "ambiguous" ? `${match.leadIds.length} leads at this address` : "no lead at this address"}`); continue; }
    if (!file) { held++; console.log(`  HELD  ${where}: no PDF on file in the estimator`); continue; }
    const lead = leads.find((l) => l.id === match.leadId)!;
    const abs = path.resolve(storageDir, file.storagePath as string);
    if (!abs.startsWith(path.resolve(storageDir) + path.sep)) throw new Error(`Refusing a path outside the storage folder: ${file.storagePath}`);
    let buffer: Buffer;
    try { buffer = await fs.readFile(abs); } catch { held++; console.log(`  HELD  ${where}: the PDF is missing from the estimator's storage`); continue; }
    const already = await prisma.file.findFirst({ where: { leadId: lead.id, category: "MEASUREMENT_REPORT", fileName: file.originalName as string, fileSize: buffer.byteLength }, select: { id: true } });
    if (already) { skipped++; console.log(`  SKIP  ${where} → ${lead.fullName}: already imported`); continue; }

    const was = stored.find((s) => s.roofrReportId === r.id) ?? {};
    const parse = await parseRoofrPdf(buffer);
    const typed = manualOverrides(was.overrides);
    const diffs = measurementDifferences(was, parse.measurements as Row).filter((d) => !(d.field in typed));
    const corrections: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(typed)) if (!valueProblem(k as MeasurementKey, v) && MEASUREMENT_KEYS.includes(k as MeasurementKey)) corrections[k] = v;
    console.log(`  ${apply ? "DONE" : "PLAN"}  ${where} → ${lead.fullName}: ${parse.measurements.totalSquares ?? "?"} sq, confidence ${parse.confidence.toFixed(2)}${Object.keys(corrections).length ? `, ${Object.keys(corrections).length} typed correction(s) carried over (${Object.keys(corrections).join(", ")})` : ""}`);
    for (const d of diffs.filter((x) => x.stored !== null)) console.log(`          ${d.field}: the estimator stored ${d.stored}, this app reads ${d.parsed ?? "nothing"} — this app's reading is kept`);
    const extra = diffs.filter((x) => x.stored === null).length;
    if (extra) console.log(`          ${extra} field(s) read here that the estimator had left empty`);
    created++;
    if (!apply) continue;
    const m = await createFromReport({ leadId: lead.id, jobId: null, buffer, fileName: file.originalName as string, fileType: "application/pdf", userId: actor.id });
    if (Object.keys(corrections).length) await updateMeasurement(m.id, { values: corrections as MeasurementValues, userId: actor.id });
  }
  console.log(`  ${created} ${apply ? "imported" : "to import"} · ${skipped} already here · ${held} held for a person`);

  // ── Counted, not imported ───────────────────────────────────────────────
  const [lists] = await q(`select (select count(*) from generated_material_lists) as lists, (select count(*) from generated_material_list_items) as items, (select count(*) from supplier_invoices) as invoices, (select count(*) from roof_jobs) as jobs`);
  console.log(`\nNot imported (nowhere to put them until the estimate builder exists): ${lists.jobs} roof jobs, ${lists.lists} material lists with ${lists.items} lines, ${lists.invoices} supplier invoices. They stay in the estimator.`);
  console.log(apply ? "\nApplied." : "\nDry run — nothing written. Re-run with --yes to apply.");
  await src.end();
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

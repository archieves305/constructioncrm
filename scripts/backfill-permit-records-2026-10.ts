import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { jurisdictionKey, jurisdictionKindFor, permitTypeKeyFor, tidyJurisdictionName } from "../src/lib/permit-intel/catalog";

/**
 * One-off: give the permits entered before Permit Intelligence their records.
 *
 * - The jurisdiction typed on each permit becomes a Jurisdiction (matched by
 *   its key, so "City Of Miami" and "City of Miami" are one) and the permit
 *   points at it. The typed text is kept.
 * - The typed permit type is matched to the catalog when it clearly names one.
 * - A permit with a submission date and no review cycle gets cycle 1, with
 *   the outcome its status implies (issued / final → approved on the issue
 *   date; denied → denied; applied → waiting).
 *
 * Run the seed first (the catalog). Dry run by default:
 *
 *   npx tsx scripts/backfill-permit-records-2026-10.ts           # report only
 *   npx tsx scripts/backfill-permit-records-2026-10.ts --apply   # write
 *
 * Idempotent: a permit already pointing at a jurisdiction is left alone, and
 * a permit with any cycle gets none.
 */
const apply = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const types = new Set((await prisma.permitTypeDef.findMany({ select: { key: true } })).map((t) => t.key));
    if (types.size === 0) throw new Error("The permit-type catalog is empty — run prisma/seed-permit-intel.ts first");
    const permits = await prisma.jobPermit.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, municipality: true, permitType: true, permitTypeKey: true, jurisdictionId: true, status: true, submittedDate: true, approvedDate: true, job: { select: { jobNumber: true } }, _count: { select: { cycles: true } } },
    });
    console.log(`${permits.length} permits${apply ? "" : " (dry run — nothing is written)"}`);
    const created = new Map<string, string>();
    let linked = 0, typed = 0, cycles = 0;
    for (const p of permits) {
      const line: string[] = [`${p.job.jobNumber} ${p.id}: "${p.municipality}" / "${p.permitType ?? "—"}" ${p.status}`];
      if (!p.jurisdictionId && p.municipality.trim()) {
        const name = tidyJurisdictionName(p.municipality);
        const key = jurisdictionKey(name);
        let jurisdictionId = created.get(key) ?? (await prisma.jurisdiction.findUnique({ where: { key }, select: { id: true } }))?.id ?? null;
        if (!jurisdictionId) {
          line.push(`create jurisdiction "${name}" (${jurisdictionKindFor(name)})`);
          if (apply) jurisdictionId = (await prisma.jurisdiction.create({ data: { key, name, kind: jurisdictionKindFor(name) } })).id;
          created.set(key, jurisdictionId ?? `new:${key}`);
        } else line.push(`jurisdiction "${name}" exists`);
        if (apply && jurisdictionId) await prisma.jobPermit.update({ where: { id: p.id }, data: { jurisdictionId } });
        linked++;
      }
      const typeKey = p.permitTypeKey ? null : permitTypeKeyFor(p.permitType);
      if (typeKey && types.has(typeKey)) {
        line.push(`type → ${typeKey}`);
        if (apply) await prisma.jobPermit.update({ where: { id: p.id }, data: { permitTypeKey: typeKey } });
        typed++;
      }
      if (p._count.cycles === 0 && p.submittedDate) {
        const outcome = p.status === "ISSUED" || p.status === "FINAL" || p.status === "IN_PROGRESS" ? "APPROVED" : p.status === "DENIED" ? "DENIED" : "PENDING";
        line.push(`cycle 1 submitted ${p.submittedDate.toISOString().slice(0, 10)} → ${outcome}`);
        if (apply) {
          await prisma.$transaction([
            prisma.permitReviewCycle.create({ data: { permitId: p.id, number: 1, submittedAt: p.submittedDate, outcome, outcomeAt: outcome === "APPROVED" ? p.approvedDate : null, notes: "Recorded from the permit as it stood before review cycles existed" } }),
            prisma.jobPermit.update({ where: { id: p.id }, data: { currentCycle: 1 } }),
          ]);
        }
        cycles++;
      }
      console.log(`  ${line.join("; ")}`);
    }
    console.log(`jurisdictions linked ${linked} (created ${created.size}), types matched ${typed}, cycles recorded ${cycles}${apply ? "" : " — would be"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

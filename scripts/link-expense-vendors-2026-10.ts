/**
 * Link existing expenses to vendor records (2026-10).
 *
 * New expenses are matched as they are written; this catches the ones that
 * were on the books before the vendor (or its alias) existed. An expense is
 * linked when its payee text contains a vendor's name or one of its aliases
 * (lib/vendors/match.ts). The payee text itself is never changed, payroll
 * rows are never matched, and an expense that already has a vendor is left
 * alone.
 *
 * Dry run by default; `--yes` applies. Idempotent — a second run links 0.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { linkAllExpenses } from "../src/lib/vendors/service";

async function main() {
  const apply = process.argv.includes("--yes");
  const result = await linkAllExpenses({ dryRun: !apply });
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: Object.keys(result.byVendor) } },
    select: { id: true, name: true },
  });
  const name = new Map(vendors.map((v) => [v.id, v.name]));

  console.log(`${result.scanned} unlinked expenses with a payee; ${result.linked} match a vendor`);
  for (const [id, count] of Object.entries(result.byVendor).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${name.get(id) ?? id}`);
  }
  console.log(apply ? `Linked ${result.linked}.` : "Dry run — nothing written. Re-run with --yes to apply.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

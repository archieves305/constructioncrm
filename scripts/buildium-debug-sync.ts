import "dotenv/config";
import { syncExpenseToBuildium } from "../src/lib/integrations/buildium/sync";

const expenseId = process.argv[2];
if (!expenseId) {
  console.error("usage: tsx scripts/buildium-debug-sync.ts <expenseId>");
  process.exit(1);
}

const bankAccountId = Number(process.argv[3] || process.env.BUILDIUM_DEFAULT_BANK_ACCOUNT_ID);
const vendorId = Number(process.argv[4]);
if (!bankAccountId || !vendorId) {
  console.error(
    "usage: tsx scripts/buildium-debug-sync.ts <expenseId> [bankAccountId] <vendorId>",
  );
  process.exit(1);
}

(async () => {
  const res = await syncExpenseToBuildium(expenseId, { bankAccountId, vendorId });
  console.log("result:", JSON.stringify(res, null, 2));
  process.exit(0);
})();

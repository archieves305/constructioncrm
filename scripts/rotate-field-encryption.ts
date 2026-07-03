import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import {
  decryptField,
  encryptField,
} from "../src/lib/crypto/field-encryption";
import { parseKeyring } from "../src/lib/crypto/field-encryption";

// Re-encrypts personnel SSNs stored under old key versions with the active
// key. Run after adding a new "vN:" entry to FIELD_ENCRYPTION_KEYS; once it
// reports 0 remaining, the old key may be removed from the env.
//
// Usage: npx tsx scripts/rotate-field-encryption.ts

async function main() {
  const raw = process.env.FIELD_ENCRYPTION_KEYS;
  if (!raw) {
    console.error("FIELD_ENCRYPTION_KEYS is not set");
    process.exit(1);
  }
  const ring = parseKeyring(raw);
  console.log(`Active key version: v${ring.activeVersion}`);

  const stale = await prisma.personnel.findMany({
    where: {
      ssnCiphertext: { not: null },
      OR: [{ ssnKeyVersion: null }, { ssnKeyVersion: { lt: ring.activeVersion } }],
    },
    select: { id: true, ssnCiphertext: true, ssnKeyVersion: true },
  });
  console.log(`${stale.length} row(s) to rotate`);

  let rotated = 0;
  for (const row of stale) {
    try {
      const plaintext = decryptField(row.ssnCiphertext!, `personnel:${row.id}`);
      const { ciphertext, keyVersion } = encryptField(plaintext, `personnel:${row.id}`);
      await prisma.personnel.update({
        where: { id: row.id },
        data: { ssnCiphertext: ciphertext, ssnKeyVersion: keyVersion },
      });
      rotated++;
    } catch (err) {
      console.error(`FAILED ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`Rotated ${rotated}/${stale.length}. Remaining: ${stale.length - rotated}`);
  await prisma.$disconnect();
}

main();

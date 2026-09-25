import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * "CV-00001" from a Postgres sequence (created in the code_violations
 * migration), read inside the create transaction — two processes can never
 * issue the same number, which the in-process counter jobs use cannot
 * guarantee. The unique index on caseNumber is the backstop.
 */
export async function nextCaseNumber(db: Db): Promise<string> {
  const rows = await db.$queryRaw<{ n: bigint | number }[]>`SELECT nextval('code_violation_case_number_seq') AS n`;
  const n = Number(rows[0]?.n ?? 0);
  return `CV-${String(n).padStart(5, "0")}`;
}

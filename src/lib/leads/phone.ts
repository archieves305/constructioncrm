import { prisma } from "@/lib/db/prisma";

/**
 * Phone numbers compared as people mean them: "(305) 555-1212",
 * "305.555.1212" and "+1 305 555 1212" are one number. Stored phones are
 * left as typed; matching reads the last ten digits on both sides.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Ids of leads whose primary or secondary phone is this number, in any format. */
export async function leadIdsWithPhone(raw: string | null | undefined): Promise<string[]> {
  const key = phoneKey(raw);
  if (!key) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM leads
    WHERE right(regexp_replace(coalesce(primary_phone, ''), '[^0-9]', '', 'g'), 10) = ${key}
       OR right(regexp_replace(coalesce(secondary_phone, ''), '[^0-9]', '', 'g'), 10) = ${key}
    LIMIT 50`;
  return rows.map((r) => r.id);
}

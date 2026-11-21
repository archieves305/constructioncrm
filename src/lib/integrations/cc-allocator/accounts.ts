import { z } from "zod";
import { env } from "@/lib/env";
import type { JobKind } from "@/lib/jobs/stage-kinds";

/**
 * The bank accounts and cards a crew payment may be paid from, read from CC
 * Allocator so the names match its bank and card feeds. CC Allocator applies
 * the company rules (2026-11-21): a bank account names its company; customer
 * jobs are paid from Bank of America only, KNU's own projects from Seacoast or
 * Bank of America; the Amex books to KNU for a customer job and to Equifirst
 * for a flip or rental. `GET /api/internal/crm-accounts?jobKind=`, bearer
 * CC_ALLOCATOR_RECON_KEY (the key the postings export already uses).
 */
const accountSchema = z.object({
  key: z.string().min(1).max(200),
  label: z.string().min(1).max(120),
  kind: z.enum(["bank", "card"]),
  companyName: z.string().max(120),
});
export type PaidFromAccount = z.infer<typeof accountSchema>;

export type PaidFromFetch = { ok: true; accounts: PaidFromAccount[] } | { ok: false; error: string };

export async function fetchPaidFromAccounts(jobKind: JobKind, timeoutMs = 5_000): Promise<PaidFromFetch> {
  const base = env.CC_ALLOCATOR_BASE_URL;
  const key = env.CC_ALLOCATOR_RECON_KEY;
  if (!base || !key) return { ok: false, error: "CC Allocator is not connected to the CRM" };
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/internal/crm-accounts?jobKind=${jobKind}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `CC Allocator answered ${res.status}` };
    const parsed = z.object({ accounts: z.array(accountSchema) }).safeParse(await res.json());
    if (!parsed.success) return { ok: false, error: "CC Allocator's account list did not match the expected shape" };
    return { ok: true, accounts: parsed.data.accounts };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "CC Allocator did not answer in time" : "CC Allocator could not be reached" };
  }
}

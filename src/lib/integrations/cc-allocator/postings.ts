import { z } from "zod";
import { env } from "@/lib/env";

/**
 * cc-allocator's export of what it has sent (or meant to send) the CRM:
 * every card / bank row that picked a CRM job or holds a CRM expense id.
 * Read-only, bearer-keyed, on the same droplet. Unset env = not configured,
 * which the page says plainly instead of failing.
 */

export const allocatorPostingSchema = z.object({
  source: z.enum(["card", "bank"]),
  id: z.string(),
  externalId: z.string(),
  status: z.string(),
  amount: z.number(),
  date: z.string(),
  payee: z.string().nullable(),
  crmJobId: z.string().nullable(),
  crmJobName: z.string().nullable(),
  crmExpenseType: z.string().nullable(),
  crmBillable: z.boolean(),
  crmExpenseId: z.string().nullable(),
  crmPostedAt: z.string().nullable(),
  lastCrmError: z.string().nullable(),
  crmRequested: z.boolean(),
  isPending: z.boolean(),
  duplicateOfId: z.string().nullable(),
});
export type AllocatorPosting = z.infer<typeof allocatorPostingSchema>;

const exportSchema = z.object({
  generatedAt: z.string(),
  postings: z.array(allocatorPostingSchema),
  counts: z.object({ card: z.number(), bank: z.number(), withExpenseId: z.number() }),
});
export type AllocatorExport = z.infer<typeof exportSchema>;

export type AllocatorFetch =
  | { configured: false }
  | { configured: true; ok: true; data: AllocatorExport }
  | { configured: true; ok: false; error: string };

export function allocatorConfigured(): boolean {
  return Boolean(env.CC_ALLOCATOR_BASE_URL && env.CC_ALLOCATOR_RECON_KEY);
}

export async function fetchAllocatorPostings(timeoutMs = 10_000): Promise<AllocatorFetch> {
  const base = env.CC_ALLOCATOR_BASE_URL;
  const key = env.CC_ALLOCATOR_RECON_KEY;
  if (!base || !key) return { configured: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/internal/crm-postings`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { error?: string }).error ?? "";
      } catch {
        /* not json */
      }
      return { configured: true, ok: false, error: `cc-allocator answered ${res.status}${detail ? `: ${detail}` : ""}` };
    }
    const parsed = exportSchema.safeParse(await res.json());
    if (!parsed.success) return { configured: true, ok: false, error: "cc-allocator's export did not match the expected shape" };
    return { configured: true, ok: true, data: parsed.data };
  } catch (e) {
    return { configured: true, ok: false, error: e instanceof Error && e.name === "AbortError" ? "cc-allocator did not answer in time" : `cc-allocator unreachable: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

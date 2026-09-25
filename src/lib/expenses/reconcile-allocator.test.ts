import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: {} }));

const { classifyAllocatorPostings, neverPostedReason } = await import("./reconcile-allocator");
import type { AllocatorPosting } from "@/lib/integrations/cc-allocator/postings";

let n = 0;
function posting(over: Partial<AllocatorPosting>): AllocatorPosting {
  n++;
  return {
    source: "card",
    id: `t${n}`,
    externalId: `t${n}`,
    status: "POSTED",
    amount: 100,
    date: "2026-09-01",
    payee: "Home Depot",
    crmJobId: "j1",
    crmJobName: "JOB-00003",
    crmExpenseType: "MATERIAL",
    crmBillable: false,
    crmExpenseId: null,
    crmPostedAt: null,
    lastCrmError: null,
    crmRequested: true,
    isPending: false,
    duplicateOfId: null,
    ...over,
  };
}

describe("neverPostedReason", () => {
  it("names the card cases in priority order", () => {
    expect(neverPostedReason(posting({ isPending: true, lastCrmError: "x" }))).toBe("pending_settlement");
    expect(neverPostedReason(posting({ duplicateOfId: "d" }))).toBe("marked_duplicate");
    expect(neverPostedReason(posting({ lastCrmError: "CRM 400" }))).toBe("error");
    expect(neverPostedReason(posting({ status: "SUGGESTED" }))).toBe("awaiting_approval");
    expect(neverPostedReason(posting({ status: "APPROVED" }))).toBe("queued");
    expect(neverPostedReason(posting({ status: "FAILED" }))).toBe("failed");
    expect(neverPostedReason(posting({ status: "POSTED" }))).toBe("not_attempted");
  });
  it("names the bank cases, with the CRM leg switch first", () => {
    const bank = (o: Partial<AllocatorPosting>) => posting({ source: "bank", externalId: "bank:x", ...o });
    expect(neverPostedReason(bank({ crmRequested: false, status: "POSTED" }))).toBe("crm_leg_off");
    expect(neverPostedReason(bank({ status: "NEEDS_ASSIGNMENT" }))).toBe("awaiting_approval");
    expect(neverPostedReason(bank({ status: "PARTIALLY_POSTED" }))).toBe("queued");
    expect(neverPostedReason(bank({ status: "FAILED", lastCrmError: "boom" }))).toBe("error");
  });
});

describe("classifyAllocatorPostings", () => {
  it("splits missing, never-posted and held, and ignores what agrees", () => {
    const agrees = posting({ externalId: "ok", crmExpenseId: "e-ok" });
    const missing = posting({ source: "bank", externalId: "bank:gone", crmExpenseId: "e-gone", amount: 14029.76 });
    const held = posting({ externalId: "held", crmExpenseId: "e-held", amount: 321.45 });
    const credit = posting({ externalId: "cr", amount: -194.74, lastCrmError: "CRM 400: Too small" });
    const legOff = posting({ source: "bank", externalId: "bank:off", crmRequested: false, amount: 11694.15 });
    const noJob = posting({ externalId: "nojob", crmJobId: null });
    const out = classifyAllocatorPostings([agrees, missing, held, credit, legOff, noJob], [
      { externalId: "ok", status: "APPROVED", id: "e-ok" },
      { externalId: "held", status: "PENDING", id: "e-held" },
    ]);
    expect(out.missingInCrm.map((p) => p.externalId)).toEqual(["bank:gone"]);
    expect(out.neverPosted.map((p) => [p.externalId, p.reason])).toEqual([
      ["bank:off", "crm_leg_off"],
      ["cr", "error"],
    ]);
    expect(out.heldPending.map((p) => p.crmExpenseIdHere)).toEqual(["e-held"]);
    expect(out.totals).toEqual({
      missing: { count: 1, amount: 14029.76 },
      neverPosted: { count: 2, amount: 11499.41, credits: { count: 1, amount: -194.74 } },
      held: { count: 1, amount: 321.45 },
    });
  });
});

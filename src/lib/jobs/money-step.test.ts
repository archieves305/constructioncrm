import { describe, expect, it } from "vitest";
import { moneyStep } from "./money-step";

describe("moneyStep", () => {
  it("a fresh fixed-price job opens on estimates with the estimate nudge", () => {
    expect(moneyStep({ jobType: "FIXED_PRICE", contractAmount: "0" }, [])).toMatchObject({ panel: "estimates", title: expect.stringContaining("estimate") });
  });
  it("a generated but unsent contract opens on the contract", () => {
    expect(moneyStep({ jobType: "FIXED_PRICE", contractAmount: 0 }, [{ status: "DRAFT" }])).toMatchObject({ panel: "contract", title: "Next: send the agreement for signature" });
    expect(moneyStep({ jobType: "FIXED_PRICE", contractAmount: 0 }, [{ status: "SENT" }])).toMatchObject({ panel: "contract", title: "Next: waiting on the customer's signature" });
  });
  it("signed, or priced without a contract, opens on invoices with no nudge", () => {
    expect(moneyStep({ jobType: "FIXED_PRICE", contractAmount: 1250 }, [{ status: "SIGNED" }])).toEqual({ panel: "invoices", title: null, body: null });
    expect(moneyStep({ jobType: "FIXED_PRICE", contractAmount: 30000 }, [])).toEqual({ panel: "invoices", title: null, body: null });
    expect(moneyStep({ jobType: "FIXED_PRICE", contractAmount: 30000 }, [{ status: "VOID" }, { status: "DECLINED" }])).toEqual({ panel: "invoices", title: null, body: null });
  });
  it("an owned rehab has no customer contract, so invoices", () => {
    expect(moneyStep({ jobType: "OWNED_REHAB", contractAmount: 0 }, [])).toEqual({ panel: "invoices", title: null, body: null });
  });
});

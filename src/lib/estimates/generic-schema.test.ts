import { describe, expect, it } from "vitest";
import { genericEstimateInputSchema } from "./generic-schema";

const base = {
  templateCategory: "DRYWALL",
  name: "Drywall estimate",
  sections: [{ title: "Section 1", items: [] }],
};

describe("genericEstimateInputSchema.status", () => {
  it("is absent when the client did not send it, so a PUT keeps the stored status", () => {
    const parsed = genericEstimateInputSchema.parse(base);
    expect(parsed.status).toBeUndefined();
  });

  it("accepts an explicit status", () => {
    expect(genericEstimateInputSchema.parse({ ...base, status: "SENT" }).status).toBe("SENT");
  });

  it("rejects an unknown status", () => {
    expect(genericEstimateInputSchema.safeParse({ ...base, status: "VOID" }).success).toBe(false);
  });
});

describe("genericEstimateInputSchema limits", () => {
  it("accepts a pasted scope paragraph up to 2000 characters and rejects beyond", () => {
    const item = (n: number) => ({ ...base, sections: [{ title: "S", items: [{ description: "x".repeat(n), unitType: "EACH", quantity: 1, unitPrice: 1 }] }] });
    expect(genericEstimateInputSchema.safeParse(item(2000)).success).toBe(true);
    const r = genericEstimateInputSchema.safeParse(item(2001));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path.join(".")).toBe("sections.0.items.0.description");
  });
});

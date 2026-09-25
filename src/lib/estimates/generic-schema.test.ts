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

import { describe, it, expect } from "vitest";
import { addressKey, parseUsAddress, addressSimilarity } from "./address";

describe("address normalization", () => {
  it("normalizes street suffixes so variants collide", () => {
    expect(addressKey("123 Main Street")).toBe(addressKey("123 Main St."));
    expect(addressKey("456 North Oak Avenue")).toBe(addressKey("456 N Oak Ave"));
  });

  it("parses a single-line US address", () => {
    const p = parseUsAddress("123 Main St, Springfield, FL 32401");
    expect(p.line1).toBe("123 Main St");
    expect(p.city).toBe("Springfield");
    expect(p.state).toBe("FL");
    expect(p.postalCode).toBe("32401");
  });

  it("scores similar addresses highly and different ones low", () => {
    expect(addressSimilarity("123 Main St, Springfield FL", "123 Main Street Springfield, FL")).toBeGreaterThan(0.7);
    expect(addressSimilarity("123 Main St", "987 Pine Blvd")).toBeLessThan(0.3);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const { phoneKey } = await import("./phone");

describe("phoneKey", () => {
  it("reads one number however it was typed", () => {
    expect(phoneKey("(305) 555-1212")).toBe("3055551212");
    expect(phoneKey("+1 305.555.1212")).toBe("3055551212");
    expect(phoneKey("13055551212")).toBe("3055551212");
  });
  it("has no key for something too short to be a number", () => {
    expect(phoneKey("555-1212")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

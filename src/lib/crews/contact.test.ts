import { describe, expect, it } from "vitest";
import { contactData, crewContactSchema, displayPhone, normalizeUsPhone } from "./contact";

describe("crew contact", () => {
  it("stores a US phone one way, however it was typed", () => {
    expect(normalizeUsPhone("(561) 555-0123")).toBe("+15615550123");
    expect(normalizeUsPhone("1-561-555-0123")).toBe("+15615550123");
    expect(normalizeUsPhone("+1 561 555 0123")).toBe("+15615550123");
    expect(normalizeUsPhone("555-0123")).toBeNull();
    expect(normalizeUsPhone("011 44 20 7946 0958")).toBeNull();
    expect(displayPhone("+15615550123")).toBe("(561) 555-0123");
  });
  it("refuses a number that is not one, and clears on empty", () => {
    expect(crewContactSchema.safeParse({ phone: "12345" }).success).toBe(false);
    expect(contactData(crewContactSchema.parse({ phone: "", foremanName: "  ", language: "es" }))).toEqual({ phone: null, foremanName: null, language: "es" });
    expect(crewContactSchema.safeParse({ language: "fr" }).success).toBe(false);
  });
  it("only what was sent changes", () => {
    expect(contactData({ language: "en" })).toEqual({ language: "en" });
  });
});

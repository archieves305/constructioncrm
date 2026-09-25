import { describe, expect, it } from "vitest";
import { describeEstimateValidationErrors } from "./validation-messages";

describe("describeEstimateValidationErrors", () => {
  const form = { sections: [{ title: "Kitchen Renovation", items: [{ description: "Remove and replace the existing cabinets, counters and backsplash" }] }] };
  it("names the section and item and tidies zod's wording", () => {
    expect(describeEstimateValidationErrors({ "sections.0.items.0.description": ["Too big: expected string to have <=300 characters"] }, form)).toEqual(["Section 1 “Kitchen Renovation”, item 1 “Remove and replace the existin…” — description longer than 300 characters"]);
  });
  it("handles section titles, top-level fields and unknown paths", () => {
    expect(describeEstimateValidationErrors({ "sections.2.title": ["Section title required"], validityDays: ["Too small: expected number to be >=1"], _root: ["Add at least one section"] }, form)).toEqual(["Section 3 — title Section title required", "Valid for (days) Too small: expected number to be >=1", "Add at least one section"]);
  });
});

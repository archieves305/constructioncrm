import { describe, it, expect } from "vitest";
import { TEMPLATE_DEFS } from "./template-defs";
import {
  ESTIMATE_UNIT_TYPES,
  ESTIMATE_TEMPLATE_CATEGORIES,
} from "./generic-schema";

describe("estimate template definitions", () => {
  it("covers all four categories with unique keys", () => {
    const keys = TEMPLATE_DEFS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    const cats = TEMPLATE_DEFS.map((t) => t.category).sort();
    expect(cats).toEqual([...ESTIMATE_TEMPLATE_CATEGORIES].sort());
  });

  it("each template has at least one section and valid unit types", () => {
    for (const t of TEMPLATE_DEFS) {
      expect(t.sections.length).toBeGreaterThan(0);
      for (const section of t.sections) {
        expect(section.title.trim().length).toBeGreaterThan(0);
        for (const item of section.items) {
          expect(item.description.trim().length).toBeGreaterThan(0);
          expect(ESTIMATE_UNIT_TYPES).toContain(item.unitType);
        }
      }
    }
  });

  it("drywall template includes the three finishing levels", () => {
    const drywall = TEMPLATE_DEFS.find((t) => t.key === "drywall")!;
    const descs = drywall.sections.flatMap((s) =>
      s.items.map((i) => i.description),
    );
    expect(descs.some((d) => /Level 3/.test(d))).toBe(true);
    expect(descs.some((d) => /Level 4/.test(d))).toBe(true);
    expect(descs.some((d) => /Level 5/.test(d))).toBe(true);
  });

  it("windows-doors template includes impact products", () => {
    const wd = TEMPLATE_DEFS.find((t) => t.key === "windows-doors")!;
    const descs = wd.sections.flatMap((s) => s.items.map((i) => i.description));
    expect(descs.some((d) => /Impact windows/i.test(d))).toBe(true);
    expect(descs.some((d) => /Impact doors/i.test(d))).toBe(true);
  });

  it("interior-renovation template includes MEP allowances and notes", () => {
    const ir = TEMPLATE_DEFS.find((t) => t.key === "interior-renovation")!;
    const titles = ir.sections.map((s) => s.title);
    expect(titles).toContain("MEP Allowances");
    expect(titles).toContain("Notes / Exclusions");
  });

  it("non-roofing templates carry a notes/exclusions section", () => {
    for (const t of TEMPLATE_DEFS.filter((x) => x.category !== "ROOFING")) {
      expect(t.sections.some((s) => /notes|exclusion/i.test(s.title))).toBe(
        true,
      );
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  CONTRACT_TEMPLATE_VERSION,
  RESIDENTIAL_CONSTRUCTION_META,
  RESIDENTIAL_CONSTRUCTION_V1,
} from "../../../prisma/seeds/contract-templates/residential-construction";
import { templateContentHash, validateTemplateContent } from "./template-content";

/**
 * The seeded template is pinned by hash. Once a contract on prod references
 * v1, its content is frozen: editing the spec must come with a bump of
 * CONTRACT_TEMPLATE_VERSION (and a new pinned hash here), or the seeder
 * refuses with SeedVersionInUseError.
 */
const PINNED: Record<number, string> = {
  1: "1e26885a2b899d3a18077e2b06792939bfe26398a0720291d6db97aa759826c8",
};

describe("contract template seed spec", () => {
  it("is valid content", () => {
    expect(validateTemplateContent(RESIDENTIAL_CONSTRUCTION_V1)).toEqual([]);
    expect(RESIDENTIAL_CONSTRUCTION_META.key).toBe("residential_construction");
  });

  it("matches its pinned hash for the current version", () => {
    const pinned = PINNED[CONTRACT_TEMPLATE_VERSION];
    expect(pinned, `no pinned hash for v${CONTRACT_TEMPLATE_VERSION} — add one`).toBeTruthy();
    expect(templateContentHash(RESIDENTIAL_CONSTRUCTION_V1)).toBe(pinned);
  });

  it("has the deposit first, summing to 100%", () => {
    const items = RESIDENTIAL_CONSTRUCTION_V1.paymentSchedule.items;
    expect(items[0].key).toBe("deposit");
    expect(items.reduce((s, i) => s + i.percent, 0)).toBe(100);
  });
});

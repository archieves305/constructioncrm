import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
import { allowedCrewCategories, crewFileWhere, DEFAULT_CREW_FILE_CATEGORIES } from "./crew-visibility";

describe("crew file visibility", () => {
  it("falls back to plans, photos, video, permit and inspection", () => {
    expect(allowedCrewCategories(null)).toEqual([...DEFAULT_CREW_FILE_CATEGORIES]);
    expect(allowedCrewCategories(undefined)).toEqual([...DEFAULT_CREW_FILE_CATEGORIES]);
    expect(allowedCrewCategories([])).toEqual([]);
  });

  it("never lets a contract, estimate or receipt in by kind", () => {
    expect(allowedCrewCategories(["PHOTOS", "ESTIMATE", "CUSTOMER_CONTRACT", "RECEIPT", "OTHER"])).toEqual(["PHOTOS", "OTHER"]);
  });

  it("allows own uploads, files shown on purpose, and allowed kinds not hidden", () => {
    expect(crewFileWhere("u1", ["PLAN_SET"])).toEqual({
      OR: [
        { uploadedByUserId: "u1" },
        { crewVisible: true },
        { AND: [{ category: { in: ["PLAN_SET"] } }, { OR: [{ crewVisible: null }, { crewVisible: true }] }] },
      ],
    });
  });
});

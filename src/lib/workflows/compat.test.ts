import { describe, expect, it } from "vitest";
import { CORE as CORE_V1 } from "../../../prisma/seeds/workflows/v1/core";
import { ROOFING as ROOFING_V1 } from "../../../prisma/seeds/workflows/v1/roofing";
import { CODE_VIOLATION } from "../../../prisma/seeds/workflows/v2/code-violation";
import { CORE } from "../../../prisma/seeds/workflows/v2/core";
import { ROOFING } from "../../../prisma/seeds/workflows/v2/roofing";
import { descendsFrom, incompatibleTrades, missingCoreKeys } from "./compat";
import type { TemplateDefinition } from "./templates/types";

const mod = (def: TemplateDefinition) => ({ moduleKey: def.key, kind: def.kind, name: def.name, definition: def });

describe("descendsFrom", () => {
  const versions = [
    { id: "v1", sourceVersionId: null },
    { id: "v2", sourceVersionId: "v1" },
    { id: "v3", sourceVersionId: "v2" },
    { id: "slim", sourceVersionId: null },
    { id: "slim-edit", sourceVersionId: "slim" },
  ];

  it("follows the editor's drafts back to the version they were copied from", () => {
    expect(descendsFrom(versions, "v2", "v1")).toBe(true);
    expect(descendsFrom(versions, "v3", "v1")).toBe(true);
    expect(descendsFrom(versions, "slim-edit", "slim")).toBe(true);
  });

  it("a seeded generation is a new lineage, and nothing descends from itself or its descendants", () => {
    expect(descendsFrom(versions, "slim", "v1")).toBe(false);
    expect(descendsFrom(versions, "slim-edit", "v1")).toBe(false);
    expect(descendsFrom(versions, "v1", "v1")).toBe(false);
    expect(descendsFrom(versions, "v1", "v2")).toBe(false);
    expect(descendsFrom(versions, "unknown", "v1")).toBe(false);
  });

  it("stops on a cycle instead of spinning", () => {
    expect(descendsFrom([{ id: "a", sourceVersionId: "b" }, { id: "b", sourceVersionId: "a" }], "a", "z")).toBe(false);
  });
});

describe("trade ↔ Core compatibility", () => {
  it("each generation fits its own Core", () => {
    expect(incompatibleTrades([mod(CORE_V1), mod(ROOFING_V1)])).toEqual([]);
    expect(incompatibleTrades([mod(CORE), mod(ROOFING)])).toEqual([]);
    expect(incompatibleTrades([mod(CODE_VIOLATION)])).toEqual([]);
  });

  it("a streamlined trade does not fit the earlier Core, nor an earlier trade the streamlined Core", () => {
    expect(missingCoreKeys(mod(CORE_V1), mod(ROOFING))).toEqual(["complete_work", "prepare_permit_documents"]);
    expect(missingCoreKeys(mod(CORE), mod(ROOFING_V1))).toEqual(["create_punch_list", "deliver_warranty_documents", "internal_quality_inspection"]);
    expect(incompatibleTrades([mod(CORE_V1), mod(ROOFING)]).map((t) => t.moduleKey)).toEqual(["roofing"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { CORE } from "../../../prisma/seeds/workflows/core";
import { ROOFING } from "../../../prisma/seeds/workflows/roofing";
import { CODE_VIOLATION } from "../../../prisma/seeds/workflows/code-violation";
import { fakeTree } from "./test-helpers";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const { validateTree } = await import("./validate");

const coreKeys = new Set(CORE.tasks.map((t) => t.key));

describe("validateTree", () => {
  it("passes the seeded templates", () => {
    expect(validateTree(fakeTree(CORE), null)).toEqual({ ok: true, issues: [] });
    expect(validateTree(fakeTree(ROOFING), coreKeys).ok).toBe(true);
  });

  it("collects every problem with a location instead of stopping at the first", () => {
    const tree = fakeTree(ROOFING);
    tree.tasks[0]!.key = "verify_roof_measurements";
    tree.tasks[1]!.key = "verify_roof_measurements"; // duplicate
    tree.tasks[2]!.title = "";
    tree.tasks[3]!.conditionAnyOf = ["nope"];
    tree.tasks[4]!.overridesCoreKey = "not_a_core_step";
    tree.dependencies.push({ id: "x", versionId: tree.id, taskKey: "mobilize", dependsOnRef: "ghost", kind: "BLOCKING" });
    tree.phases.push({ ...tree.phases[0]!, id: "empty", key: "empty_phase", name: "Empty" });
    const r = validateTree(tree, coreKeys);
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => i.message);
    expect(msgs.some((m) => m.includes("Duplicate step key"))).toBe(true);
    expect(msgs.some((m) => m.includes("has no title"))).toBe(true);
    expect(msgs.some((m) => m.includes('unknown scope toggle "nope"'))).toBe(true);
    expect(msgs.some((m) => m.includes("does not exist"))).toBe(true);
    expect(msgs.some((m) => m.includes('unknown step "ghost"'))).toBe(true);
    expect(msgs.some((m) => m.includes("has no steps"))).toBe(true);
    expect(r.issues.find((i) => i.message.includes("ghost"))?.taskKey).toBe("mobilize");
  });

  it("reports a cycle with its path and the legal-warning rule", () => {
    const tree = fakeTree(ROOFING);
    tree.dependencies.push({ id: "c", versionId: tree.id, taskKey: "verify_roof_measurements", dependsOnRef: "confirm_roof_system", kind: "BLOCKING" });
    const noPermit = tree.phases.find((p) => p.conditionPermit === "NOT_REQUIRED")!;
    noPermit.note = null;
    const r = validateTree(tree, coreKeys);
    expect(r.issues.some((i) => i.message.startsWith("Dependency cycle: verify_roof_measurements → confirm_roof_system → verify_roof_measurements"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("legal warning") && i.phaseKey === "no_permit")).toBe(true);
  });

  it("Core must keep the determination step and may not use core: refs", () => {
    const tree = fakeTree(CORE);
    tree.tasks = tree.tasks.filter((t) => t.key !== "determine_permit_requirement");
    tree.dependencies = tree.dependencies.filter((d) => d.dependsOnRef !== "determine_permit_requirement");
    const r = validateTree(tree, null);
    expect(r.issues.some((i) => i.message.includes('key "determine_permit_requirement"'))).toBe(true);
  });
});

describe("validateTree — VIOLATION kind", () => {
  it("passes the seeded code-violation template without needing Core", () => {
    expect(validateTree(fakeTree(CODE_VIOLATION), null)).toEqual({ ok: true, issues: [] });
  });

  it("rejects core: references, off-template anchors and overrides; warns on payment evidence", () => {
    const tree = fakeTree(CODE_VIOLATION);
    tree.dependencies.push({ id: "x", versionId: tree.id, taskKey: "close_case", dependsOnRef: "core:close_job", kind: "BLOCKING" });
    tree.tasks[0]!.overridesCoreKey = "review_contract";
    tree.tasks[1]!.requiredEvidence = "PAYMENT_STATUS";
    const r = validateTree(tree, null);
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => `${i.level}:${i.message}`);
    expect(msgs.some((m) => m.startsWith("error:") && m.includes("never composes with Core"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("error:") && m.includes("only a trade step may override"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("warning:") && m.includes("FINE_STATUS"))).toBe(true);
    // A trade may not use the case anchors.
    const roofing = fakeTree(ROOFING);
    roofing.tasks[0]!.anchor = "HEARING_DATE";
    expect(validateTree(roofing, coreKeys).issues.some((i) => i.message.includes("hearing date anchor only exists on a violation template"))).toBe(true);
  });
});

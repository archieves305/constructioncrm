import { describe, expect, it, vi } from "vitest";
import { CORE as CORE_V2 } from "../../../prisma/seeds/workflows/v2/core";
import { CORE as CORE_V3, CUSTOMER_JOB } from "../../../prisma/seeds/workflows/v3/core";
import { ROOFING } from "../../../prisma/seeds/workflows/v2/roofing";
import { INTERIOR_RENOVATION } from "../../../prisma/seeds/workflows/v2/interior-renovation";
import { DOORS_WINDOWS } from "../../../prisma/seeds/workflows/v2/doors-windows";
import type { TemplateDefinition } from "./templates/types";
import { compose, type ComposeModule } from "./compose";
import { incompatibleTrades } from "./compat";
import { fakeTree } from "./test-helpers";
import { contentHash } from "./seed";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const { validateTree } = await import("./validate");

/**
 * Core generation 3: generation 2 plus the "Client job" toggle (Richard,
 * 2026-11-20). On, a client job composes exactly as before; off — our own
 * flips and rentals — the contract, deposit, final invoice and final
 * payment steps and the customer's checklist lines are left out.
 */
const mod = (def: TemplateDefinition, version: number): ComposeModule => ({
  moduleKey: def.key,
  kind: def.kind,
  name: def.name,
  trade: def.trade,
  versionId: `v-${def.key}-${version}`,
  version,
  definition: def,
});
type Permit = "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED";
const build = (core: TemplateDefinition, trades: TemplateDefinition[], permitStatus: Permit, client?: boolean) =>
  compose({
    modules: [mod(core, core === CORE_V3 ? 3 : 2), ...trades.map((t) => mod(t, 2))],
    permitStatus,
    scopeToggles: client === undefined ? {} : { core: { [CUSTOMER_JOB]: client } },
  });
const keys = (p: ReturnType<typeof compose>) => p.tasks.map((t) => t.key);
const CUSTOMER_STEPS = ["review_contract", "verify_deposit", "submit_final_invoice", "confirm_final_payment"];

describe("Core generation 3", () => {
  it("is a valid template with the same step keys as generation 2", () => {
    expect(validateTree(fakeTree(CORE_V3), null)).toEqual({ ok: true, issues: [] });
    expect(CORE_V3.tasks.map((t) => t.key)).toEqual(CORE_V2.tasks.map((t) => t.key));
    expect(CORE_V3.scopeToggles.map((t) => [t.key, t.default])).toEqual([[CUSTOMER_JOB, true]]);
  });

  it("composes a client job exactly as generation 2 did", () => {
    for (const trades of [[], [ROOFING], [ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS]]) {
      for (const p of ["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"] as const) {
        expect(keys(build(CORE_V3, trades, p))).toEqual(keys(build(CORE_V2, trades, p)));
      }
    }
  });

  it("leaves the customer's steps off our own projects", () => {
    const own = build(CORE_V3, [ROOFING], "REQUIRED", false);
    for (const k of CUSTOMER_STEPS) expect(keys(own)).not.toContain(`core:${k}`);
    expect(own.tasks.length).toBe(build(CORE_V3, [ROOFING], "REQUIRED").tasks.length - CUSTOMER_STEPS.length);

    // Production start waits on the permit only; closing waits on the punch list, inspection and releases.
    const deps = (k: string) => own.tasks.find((t) => t.key === `core:${k}`)!.dependsOn.map((d) => d.key).sort();
    expect(deps("confirm_production_start")).not.toContain("core:verify_deposit");
    expect(deps("close_job")).toEqual(["core:collect_lien_releases", "core:complete_punch_list", "core:obtain_final_inspection"]);

    const lines = own.tasks.flatMap((t) => t.checklist.map((c) => c.label));
    expect(lines.some((l) => /customer/i.test(l))).toBe(false);
    expect(lines).not.toContain("Job moved to the Closed stage");
  });

  it("every streamlined trade fits it", () => {
    for (const t of [ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS]) {
      expect(incompatibleTrades([mod(CORE_V3, 3), mod(t, 2)] as never)).toEqual([]);
    }
  });

  // Pinned when generation 3 was written. Once a job pins it on prod, a
  // change is a new generation, never a new hash.
  it("hash is pinned", () => {
    expect(contentHash(CORE_V3)).toBe("2bace47a5b15337a09e0553993090beb0c74501763f45c4d46cd4f1e797a4791");
  });
});

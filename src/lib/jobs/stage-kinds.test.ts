import { describe, expect, it } from "vitest";
import { stagesForView, jobKindOf, mapStageToKind, NEXT_ACTION, STAGE_SEED, stagesFor, START_STAGE, REHAB_DONE_STAGE } from "./stage-kinds";

const stages = STAGE_SEED.map((s) => ({ id: s.name, name: s.name, stageOrder: s.stageOrder, kinds: [...s.kinds] }));
const names = (list: { name: string }[]) => list.map((s) => s.name);

describe("stage kinds", () => {
  it("tells a client job from our own flips and rentals", () => {
    expect(jobKindOf({ jobType: "FIXED_PRICE" })).toBe("CLIENT");
    expect(jobKindOf({ jobType: "COST_PLUS", ownedPurpose: "RENTAL" })).toBe("CLIENT");
    expect(jobKindOf({ jobType: "OWNED_REHAB", ownedPurpose: "RENTAL" })).toBe("RENTAL");
    expect(jobKindOf({ jobType: "OWNED_REHAB", ownedPurpose: null })).toBe("FLIP");
  });

  it("a client job keeps today's fifteen stages", () => {
    expect(names(stagesFor(stages, "CLIENT"))).toEqual([
      "Won", "Deposit Needed", "Financing Cleared", "Measure Complete", "Scope Finalized", "Permit Submitted",
      "Permit Corrections", "Permit Approved", "Materials Ordered", "Scheduled", "In Progress", "Punch List",
      "Final Inspection", "Final Payment Due", "Closed",
    ]);
  });

  it("flips and rentals skip the money stages and end at a sale or a lease", () => {
    const flip = names(stagesFor(stages, "FLIP"));
    const rental = names(stagesFor(stages, "RENTAL"));
    for (const list of [flip, rental]) {
      expect(list).not.toContain("Deposit Needed");
      expect(list).not.toContain("Financing Cleared");
      expect(list).not.toContain("Final Payment Due");
      expect(list[0]).toBe("Planning");
      expect(list.at(-1)).toBe("Closed");
    }
    expect(flip.slice(-4)).toEqual(["Listed", "Under Contract", "Sold", "Closed"]);
    expect(rental.slice(-3)).toEqual(["Ready to Rent", "Leased", "Closed"]);
  });

  it("every named stage exists and has a next action", () => {
    const all = new Set(STAGE_SEED.map((s) => s.name));
    for (const n of [...Object.values(START_STAGE), ...Object.values(REHAB_DONE_STAGE)]) expect(all.has(n)).toBe(true);
    for (const n of all) expect(n in NEXT_ACTION).toBe(true);
  });

  it("moves a job to the matching stage of its new kind", () => {
    const at = (n: string) => stages.find((s) => s.name === n)!;
    expect(mapStageToKind(stages, at("Deposit Needed"), "FLIP")?.name).toBe("Planning");
    expect(mapStageToKind(stages, at("In Progress"), "RENTAL")?.name).toBe("In Progress");
    expect(mapStageToKind(stages, at("Final Payment Due"), "FLIP")?.name).toBe("Listed");
    expect(mapStageToKind(stages, at("Final Payment Due"), "RENTAL")?.name).toBe("Ready to Rent");
    expect(mapStageToKind(stages, at("Closed"), "FLIP")?.name).toBe("Closed");
    expect(mapStageToKind(stages, at("Planning"), "CLIENT")?.name).toBe("Won");
    expect(mapStageToKind(stages, at("Sold"), "CLIENT")?.name).toBe("Final Payment Due");
  });

  it("the Our projects board shows the shared stages, then a flip's ending, then a rental's", () => {
    expect(names(stagesForView(stages, "OWNED")).slice(-6)).toEqual(["Listed", "Under Contract", "Sold", "Ready to Rent", "Leased", "Closed"]);
    expect(names(stagesForView(stages, "OWNED"))[0]).toBe("Planning");
    expect(names(stagesForView(stages, "RENTAL"))).toEqual(names(stagesFor(stages, "RENTAL")));
  });
});

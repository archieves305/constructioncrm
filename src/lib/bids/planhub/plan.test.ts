import { describe, expect, it } from "vitest";
import { boardUpdate, planBoard, planhubSuggestion, projectFills, tradeMatches, type BoardProjectCandidate } from "./plan";
import type { BoardCard } from "./parse";

const NOW = new Date("2026-11-19T15:00:00Z");
const card = (over: Partial<BoardCard> = {}): BoardCard => ({ name: "Seventh on Haverhill", stage: "SAVED", dueOn: "2026-12-04", dueText: "DUE DEC 04", bidValue: 0, ...over });
const proj = (over: Partial<BoardProjectCandidate> = {}): BoardProjectCandidate => ({ id: "p1", number: "BP-00001", name: "Seventh on Haverhill", planhubName: "Seventh on Haverhill", planhubStage: "SAVED", planhubDueAt: "2026-12-04T12:00:00.000Z", ...over });

describe("planBoard", () => {
  it("creates a card no project carries", () => {
    const [r] = planBoard([card()], []);
    expect(r.action).toBe("create");
    expect(r.match).toBeNull();
  });
  it("matches by the PlanHub name before the project's own name, ignoring punctuation and case", () => {
    const renamed = proj({ name: "7th on Haverhill (WPB)", planhubName: "Seventh on Haverhill" });
    const [r] = planBoard([card({ name: "SEVENTH ON HAVERHILL" })], [renamed, proj({ id: "p2", name: "Other", planhubName: null })]);
    expect(r.match?.id).toBe("p1");
    expect(r.action).toBe("same");
  });
  it("reports a column move and a new due date", () => {
    const [r] = planBoard([card({ stage: "SUBMITTED", dueOn: "2026-12-08" })], [proj()]);
    expect(r.action).toBe("update");
    expect(r.changes).toEqual([
      { field: "stage", label: "PlanHub column", from: "Saved", to: "Submitted" },
      { field: "due", label: "Due to the GC", from: "2026-12-04", to: "2026-12-08" },
    ]);
  });
  it("leaves two projects of the same name to a person", () => {
    const [r] = planBoard([card()], [proj(), proj({ id: "p2", number: "BP-00002" })]);
    expect(r.match).toBeNull();
    expect(r.ambiguous.map((a) => a.id)).toEqual(["p1", "p2"]);
  });
});

describe("boardUpdate", () => {
  it("moves the column with its time and keeps an unchanged due date", () => {
    expect(boardUpdate(card({ stage: "WON" }), proj(), NOW)).toEqual({ planhubSeenAt: NOW, planhubStage: "WON", planhubStageAt: NOW });
  });
  it("names an unnamed project and sets its due day at noon UTC", () => {
    expect(boardUpdate(card({ dueOn: "2026-12-09" }), proj({ planhubName: null }), NOW)).toEqual({ planhubSeenAt: NOW, planhubName: "Seventh on Haverhill", planhubDueAt: new Date("2026-12-09T12:00:00.000Z") });
  });
});

describe("projectFills", () => {
  const page = { name: "MIA Restrooms", address: { address1: "4200 NW 21st St", city: "Miami", state: "FL", zipCode: "33142" }, projectType: "Renovation", platformRef: "609262", platformUrl: "https://subcontractor.planhub.com/leads/details/609262/project-info" };
  it("fills only the blanks", () => {
    expect(projectFills(page, { name: "MIA CT restrooms G2", address1: "", city: null, state: "FL", zipCode: null, projectType: "Remodel", platformRef: null, platformUrl: null }).map((f) => f.field)).toEqual(["address1", "city", "zipCode", "platformRef", "platformUrl"]);
  });
  it("fills everything for a new project", () => {
    expect(projectFills(page, null)).toHaveLength(8);
  });
});

describe("tradeMatches", () => {
  const cats = [{ id: "plb", name: "Plumbing" }, { id: "dem", name: "Demolition" }, { id: "dw", name: "Drywall" }, { id: "fl", name: "Flooring" }];
  it("maps PlanHub's trades to the CRM's where one reads as the other", () => {
    expect(tradeMatches(["Plumbing Installation", "Interior Demolition", "Tile Flooring", "Firestopping"], cats)).toEqual([
      { trade: "Plumbing Installation", serviceCategoryId: "plb" },
      { trade: "Interior Demolition", serviceCategoryId: "dem" },
      { trade: "Tile Flooring", serviceCategoryId: "fl" },
      { trade: "Firestopping", serviceCategoryId: null },
    ]);
  });
});

describe("planhubSuggestion", () => {
  const opp = (over: Partial<{ submissions: number; awards: number; scopes: { status: string }[] }> = {}) => ({ submissions: 0, awards: 0, scopes: [{ status: "PENDING" }], ...over });
  it("asks nothing for Saved, Estimating or Bidding", () => {
    for (const s of ["SAVED", "ESTIMATING", "BIDDING"] as const) expect(planhubSuggestion({ planhubStage: s, opportunities: [opp()] })).toBeNull();
    expect(planhubSuggestion({ planhubStage: null, opportunities: [] })).toBeNull();
  });
  it("asks for the GC first when there is none", () => {
    expect(planhubSuggestion({ planhubStage: "SUBMITTED", opportunities: [] })?.kind).toBe("ADD_GC");
  });
  it("asks for what the record lacks, and stops once it has it", () => {
    expect(planhubSuggestion({ planhubStage: "SUBMITTED", opportunities: [opp()] })?.kind).toBe("RECORD_SENT");
    expect(planhubSuggestion({ planhubStage: "SUBMITTED", opportunities: [opp({ submissions: 1 })] })).toBeNull();
    expect(planhubSuggestion({ planhubStage: "WON", opportunities: [opp()] })?.kind).toBe("RECORD_AWARD");
    expect(planhubSuggestion({ planhubStage: "WON", opportunities: [opp({ awards: 1 })] })).toBeNull();
    expect(planhubSuggestion({ planhubStage: "LOST", opportunities: [opp()] })?.kind).toBe("MARK_LOST");
    expect(planhubSuggestion({ planhubStage: "LOST", opportunities: [opp({ scopes: [{ status: "LOST" }] })] })).toBeNull();
  });
});

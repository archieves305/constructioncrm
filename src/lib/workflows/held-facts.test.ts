import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: vi.fn() }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent: vi.fn() }));

import { linesToTick, type HeldFacts } from "./gates";
import { suggestTradeKeys } from "./auto-apply";

vi.mock("./apply", () => ({ applyWorkflow: vi.fn() }));

const none: HeldFacts = { projectManagerSet: false, superintendentSet: false, targetStartSet: false, permitOnFile: false, permitsClosed: false, crewInstallSet: false };
const line = (key: string, label: string, done = false) => ({ key, label, done });

describe("linesToTick", () => {
  const assign = [line("a", "Project manager set on the job"), line("b", "Superintendent / field lead set on the Workflow team")];

  it("ticks the PM line once the job has a PM, and the superintendent line once one is on the team", () => {
    expect(linesToTick(assign, none)).toEqual([]);
    expect(linesToTick(assign, { ...none, projectManagerSet: true })).toEqual(["a"]);
    expect(linesToTick(assign, { ...none, projectManagerSet: true, superintendentSet: true })).toEqual(["a", "b"]);
  });

  it("never re-ticks a line that is already done", () => {
    expect(linesToTick([line("a", "Project manager set on the job", true)], { ...none, projectManagerSet: true })).toEqual([]);
  });

  it("covers the start date and the permit lines of the streamlined templates", () => {
    const lines = [
      line("s", "Target start date set on the job"),
      line("p", "Permit added on the Permits tab with the application date"),
      line("c", "Permit closed on the Permits tab — or no permit"),
    ];
    expect(linesToTick(lines, { ...none, targetStartSet: true, permitOnFile: true })).toEqual(["s", "p"]);
    expect(linesToTick(lines, { ...none, permitsClosed: true })).toEqual(["c"]);
  });

  it("ticks 'Crew and install date set' once a crew has an install date", () => {
    const lines = [line("i", "Crew and install date set")];
    expect(linesToTick(lines, none)).toEqual([]);
    expect(linesToTick(lines, { ...none, crewInstallSet: true })).toEqual(["i"]);
  });

  it("always ticks 'Job moved to the Closed stage' — completing the step moves the stage", () => {
    expect(linesToTick([line("z", "Job moved to the Closed stage")], none)).toEqual(["z"]);
  });

  it("leaves a reworded line to a manual tick", () => {
    expect(linesToTick([line("a", "PM assigned")], { ...none, projectManagerSet: true })).toEqual([]);
  });
});

describe("suggestTradeKeys", () => {
  const templates = [
    { key: "roofing", categories: ["Roofing", "Roof Replacement"] },
    { key: "interior_renovation", categories: ["Interior Renovations", "Kitchen Remodel"] },
    { key: "doors_windows", categories: ["Windows", "Doors"] },
  ];

  it("picks every trade one of the lead's services points at, ignoring case and spacing", () => {
    expect(suggestTradeKeys(templates, [" roofing ", "WINDOWS"])).toEqual(["roofing", "doors_windows"]);
  });

  it("is Core-only (no trades) when nothing matches", () => {
    expect(suggestTradeKeys(templates, ["General"])).toEqual([]);
    expect(suggestTradeKeys(templates, [])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { stageTone, stageToneKey } from "./stage-colors";

const jobStages = [
  "Won",
  "Deposit Needed",
  "Financing Cleared",
  "Measure Complete",
  "Scope Finalized",
  "Permit Submitted",
  "Permit Corrections",
  "Permit Approved",
  "Materials Ordered",
  "Scheduled",
  "In Progress",
  "Punch List",
  "Final Inspection",
  "Final Payment Due",
  "Closed",
].map((name, i) => ({ id: `j${i}`, name, stageOrder: i + 1, isClosed: name === "Closed" }));

const leadStages = [
  ["New Lead", {}],
  ["Contact Attempted", {}],
  ["Contacted", {}],
  ["Appointment Scheduled", {}],
  ["Inspection Completed", {}],
  ["Estimate Sent", {}],
  ["Follow-Up Needed", {}],
  ["Negotiation", {}],
  ["Won", { isClosed: true, isWon: true }],
  ["Lost", { isClosed: true, isLost: true }],
  ["On Hold", {}],
].map(([name, flags], i) => ({ id: `l${i}`, name: name as string, stageOrder: i + 1, ...(flags as object) }));

describe("stageToneKey", () => {
  it("runs the 14 open job stages cool → warm and ends green", () => {
    const keys = jobStages.map((s) => stageToneKey(s, jobStages));
    expect(keys[0]).toBe("phase-0");
    expect(keys[3]).toBe("phase-1");
    expect(keys[6]).toBe("phase-2");
    expect(keys[9]).toBe("phase-3");
    expect(keys[12]).toBe("phase-4");
    expect(keys[14]).toBe("done");
    // monotonic
    const phases = keys.slice(0, 14).map((k) => Number(k.split("-")[1]));
    expect([...phases].sort((a, b) => a - b)).toEqual(phases);
  });
  it("lost is red, won is green, on hold is grey, and none of them take a phase", () => {
    expect(stageToneKey(leadStages[9], leadStages)).toBe("lost");
    expect(stageToneKey(leadStages[8], leadStages)).toBe("done");
    expect(stageToneKey(leadStages[10], leadStages)).toBe("hold");
    expect(stageToneKey(leadStages[7], leadStages)).toBe("phase-4");
  });
  it("spreads a tiny board without crashing", () => {
    const three = jobStages.slice(0, 3);
    expect(three.map((s) => stageToneKey(s, three))).toEqual(["phase-0", "phase-1", "phase-3"]);
  });
});

describe("stageTone", () => {
  it("resolves by name, and is neutral for unknown or missing input", () => {
    expect(stageTone("Closed", jobStages).key).toBe("done");
    expect(stageTone("Nope", jobStages).key).toBe("neutral");
    expect(stageTone(undefined, jobStages).key).toBe("neutral");
    expect(stageTone("Won", undefined).key).toBe("neutral");
  });
  it("returns complete class strings", () => {
    const t = stageTone("Scheduled", jobStages);
    expect(t.pill).toMatch(/^bg-stage-\d-soft text-stage-\d-fg$/);
  });
});

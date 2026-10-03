import { describe, expect, it } from "vitest";
import { inspectionTypeForStep, matchInspectionStep, passClosesPermit, resultAppliesToStep, statusStamps, typesForStep, type StepCandidate } from "./rules";

const today = new Date("2026-10-05T12:00:00.000Z");
const typed = new Date("2026-09-01T00:00:00.000Z");
const step = (key: string, sort: number, status = "PENDING"): StepCandidate => ({ id: key, workflowTaskKey: key, workflowSortOrder: sort, status });

describe("statusStamps", () => {
  it("stamps the issue date when a permit is issued", () => {
    expect(statusStamps("ISSUED", { approvedDate: null, finalPassedDate: null }, today)).toEqual({ approvedDate: today });
  });
  it("stamps both dates on final when neither is on file", () => {
    expect(statusStamps("FINAL", { approvedDate: null, finalPassedDate: null }, today)).toEqual({ approvedDate: today, finalPassedDate: today });
  });
  it("never overwrites a date someone typed", () => {
    expect(statusStamps("FINAL", { approvedDate: typed, finalPassedDate: typed }, today)).toEqual({});
  });
  it("stamps nothing for the other statuses", () => {
    for (const s of ["APPLIED", "IN_PROGRESS", "EXPIRED", "DENIED", "UNKNOWN"] as const) expect(statusStamps(s, { approvedDate: null, finalPassedDate: null }, today)).toEqual({});
  });
});

describe("passClosesPermit", () => {
  it("closes an issued permit on a passed final with nothing else booked", () => {
    expect(passClosesPermit("FINAL", "ISSUED", 0)).toBe(true);
    expect(passClosesPermit("ROOFING_FINAL", "IN_PROGRESS", 0)).toBe(true);
  });
  it("waits while another inspection is still booked on the permit", () => {
    expect(passClosesPermit("FINAL", "ISSUED", 1)).toBe(false);
  });
  it("ignores inspections that are not a final, and permits that are not in force", () => {
    expect(passClosesPermit("ROUGH", "ISSUED", 0)).toBe(false);
    expect(passClosesPermit("FINAL", "APPLIED", 0)).toBe(false);
    expect(passClosesPermit("FINAL", "FINAL", 0)).toBe(false);
  });
});

describe("matchInspectionStep", () => {
  const roofing = [step("core:obtain_final_inspection", 900), step("roofing:dry_in_inspection", 420), step("roofing:deck_inspection", 410)];
  it("matches a final to the final step", () => {
    expect(matchInspectionStep("ROOFING_FINAL", roofing)?.id).toBe("core:obtain_final_inspection");
    expect(matchInspectionStep("FINAL", roofing)?.id).toBe("core:obtain_final_inspection");
  });
  it("matches an in-progress inspection to the earliest in-progress step", () => {
    expect(matchInspectionStep("ROOFING_IN_PROGRESS", roofing)?.id).toBe("roofing:deck_inspection");
    expect(matchInspectionStep("ROOFING_IN_PROGRESS", [step("doors_windows:in_progress_inspection", 300)])?.id).toBe("doors_windows:in_progress_inspection");
  });
  it("matches every rough discipline to the rough step", () => {
    const interior = [step("interior_renovation:rough_inspections", 300), step("interior_renovation:insulation_inspection", 310)];
    for (const t of ["ROUGH", "FRAMING", "ELECTRICAL", "PLUMBING", "MECHANICAL"] as const) expect(matchInspectionStep(t, interior)?.id).toBe("interior_renovation:rough_inspections");
  });
  it("returns nothing when the workflow has no step of that kind", () => {
    expect(matchInspectionStep("ELECTRICAL", roofing)).toBeNull();
    expect(matchInspectionStep("FINAL", [])).toBeNull();
  });
  it("gives an inspection of no particular kind the only open step, and nothing when there are several", () => {
    expect(matchInspectionStep("OTHER", [step("interior_renovation:insulation_inspection", 310)])?.id).toBe("interior_renovation:insulation_inspection");
    expect(matchInspectionStep("OTHER", roofing)).toBeNull();
  });
});

describe("typesForStep / inspectionTypeForStep", () => {
  it("lists the types a step waits for", () => {
    expect(typesForStep("core:obtain_final_inspection")).toEqual(["ROOFING_FINAL", "FINAL"]);
    expect(typesForStep("roofing:dry_in_inspection")).toEqual(["ROOFING_IN_PROGRESS"]);
    expect(typesForStep("interior_renovation:rough_inspections")).toEqual(["ROUGH", "FRAMING", "ELECTRICAL", "PLUMBING", "MECHANICAL"]);
    expect(typesForStep("interior_renovation:insulation_inspection")).toEqual([]);
  });
  it("files a step's result under a fitting type", () => {
    expect(inspectionTypeForStep("core:obtain_final_inspection")).toBe("FINAL");
    expect(inspectionTypeForStep("roofing:dry_in_inspection")).toBe("ROOFING_IN_PROGRESS");
    expect(inspectionTypeForStep("doors_windows:in_progress_inspection")).toBe("OTHER");
    expect(inspectionTypeForStep("interior_renovation:rough_inspections")).toBe("ROUGH");
    expect(inspectionTypeForStep("interior_renovation:insulation_inspection")).toBe("OTHER");
  });
});

describe("resultAppliesToStep", () => {
  const base = { explicit: false, allPermitsFinal: false };
  it("always carries a failure to the step, even one already blocked", () => {
    expect(resultAppliesToStep({ ...base, result: "FAIL", step: step("interior_renovation:rough_inspections", 1) })).toBe(true);
    expect(resultAppliesToStep({ ...base, result: "FAIL", step: step("core:obtain_final_inspection", 1, "BLOCKED") })).toBe(true);
  });
  it("lets one pass finish a single-inspection step", () => {
    expect(resultAppliesToStep({ ...base, result: "PASS", step: step("roofing:dry_in_inspection", 1) })).toBe(true);
    expect(resultAppliesToStep({ ...base, result: "CONDITIONAL", step: step("roofing:deck_inspection", 1) })).toBe(true);
  });
  it("does not let one discipline's pass finish the rough step unless the person says so", () => {
    const rough = step("interior_renovation:rough_inspections", 1);
    expect(resultAppliesToStep({ ...base, result: "PASS", step: rough })).toBe(false);
    expect(resultAppliesToStep({ ...base, result: "PASS", step: rough, explicit: true })).toBe(true);
  });
  it("finishes the final step only when every permit on the job is closed", () => {
    const final = step("core:obtain_final_inspection", 1);
    expect(resultAppliesToStep({ ...base, result: "PASS", step: final })).toBe(false);
    expect(resultAppliesToStep({ ...base, result: "PASS", step: final, allPermitsFinal: true })).toBe(true);
  });
  it("never completes a step that is blocked on a correction", () => {
    expect(resultAppliesToStep({ ...base, result: "PASS", step: step("roofing:dry_in_inspection", 1, "BLOCKED"), explicit: true })).toBe(false);
  });
});

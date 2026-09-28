import { describe, expect, it } from "vitest";
import { jobFieldsFromTeam } from "./team-mirror";

const job = { projectManagerId: null, salesRepId: "rep-1" };

describe("jobFieldsFromTeam", () => {
  it("a named PM slot becomes the job's PM", () => {
    expect(jobFieldsFromTeam({ PROJECT_MANAGER: "pm-1" }, job)).toEqual({ projectManagerId: "pm-1" });
  });

  it("a slot that already matches the job changes nothing", () => {
    expect(jobFieldsFromTeam({ SALES_REP: "rep-1" }, job)).toEqual({});
    expect(jobFieldsFromTeam({ PROJECT_MANAGER: "pm-1" }, { ...job, projectManagerId: "pm-1" })).toEqual({});
  });

  it("a different sales rep slot replaces the job's sales rep", () => {
    expect(jobFieldsFromTeam({ SALES_REP: "rep-2" }, job)).toEqual({ salesRepId: "rep-2" });
  });

  it("clearing a slot falls back to the job's field and never clears it", () => {
    expect(jobFieldsFromTeam({ PROJECT_MANAGER: null, SALES_REP: null }, { ...job, projectManagerId: "pm-1" })).toEqual({});
  });

  it("other roles do not touch the job", () => {
    expect(jobFieldsFromTeam({ OFFICE: "o-1", FIELD_LEAD: "f-1" } as never, job)).toEqual({});
  });
});

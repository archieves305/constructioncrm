import { describe, expect, it } from "vitest";
import { computeFunnel, type FunnelStage } from "./funnel";

const stage = (id: string, name: string, stageOrder: number, flags: Partial<FunnelStage> = {}): FunnelStage => ({
  id, name, stageOrder, isWon: false, isLost: false, ...flags,
});

const STAGES = [
  stage("new", "New Lead", 1),
  stage("att", "Contact Attempted", 2),
  stage("con", "Contacted", 3),
  stage("apt", "Appointment Scheduled", 4),
  stage("est", "Estimate Sent", 6),
  stage("won", "Won", 9, { isWon: true }),
  stage("lost", "Lost", 10, { isLost: true }),
  stage("hold", "On Hold", 11),
];

const lead = (currentStageId: string, visitedStageIds: string[] = []) => ({ currentStageId, visitedStageIds });

describe("computeFunnel", () => {
  it("counts a lead that jumped straight to Won as having reached every step", () => {
    const { reached, metrics } = computeFunnel(STAGES, [lead("won", ["won"]), lead("new")]);
    expect(reached).toEqual({ total: 2, contacted: 1, appointed: 1, estimated: 1, won: 1 });
    expect(metrics.leadToWon).toBe("50.0");
    expect(metrics.estimateToWon).toBe("100.0");
  });

  it("never exceeds 100% however leads skip and re-enter stages", () => {
    const leads = [
      lead("won", ["est", "won"]),
      lead("won", ["won"]),
      lead("won", ["apt", "est", "apt", "est", "won"]),
      lead("est", ["est"]),
      lead("new"),
    ];
    const { metrics } = computeFunnel(STAGES, leads);
    for (const v of Object.values(metrics)) expect(Number(v)).toBeLessThanOrEqual(100);
    expect(metrics.appointmentToEstimate).toBe("100.0");
    expect(metrics.estimateToWon).toBe("75.0");
  });

  it("does not treat Lost or On Hold as progress, but keeps what the lead reached before", () => {
    const { reached } = computeFunnel(STAGES, [lead("lost", ["con", "lost"]), lead("hold", ["hold"]), lead("lost", ["lost"])]);
    expect(reached).toEqual({ total: 3, contacted: 1, appointed: 0, estimated: 0, won: 0 });
  });

  it("returns zeros, not NaN, with no leads", () => {
    const { metrics } = computeFunnel(STAGES, []);
    expect(metrics).toEqual({ leadToContact: "0", contactToAppointment: "0", appointmentToEstimate: "0", estimateToWon: "0", leadToWon: "0" });
  });

  it("reads a missing stage name as nobody having reached it", () => {
    const { reached } = computeFunnel(STAGES.filter((s) => s.name !== "Contacted"), [lead("won", ["won"])]);
    expect(reached.contacted).toBe(0);
    expect(reached.won).toBe(1);
  });
});

/**
 * The sales funnel, counted per lead.
 *
 * It used to divide the number of moves INTO one stage by the number of moves
 * into the stage before it. Leads skip stages (straight to Won) and re-enter
 * them, so a step could read 400%. Here a lead counts as having reached a
 * step when it ever stood at that stage or any later progress stage — a Won
 * lead reached every step — so each step is a subset of the one before and no
 * ratio can pass 100%.
 */
export type FunnelStage = { id: string; name: string; stageOrder: number; isWon: boolean; isLost: boolean };

/** One lead: the stage it is in now and every stage it was ever moved to. */
export type FunnelLead = { currentStageId: string; visitedStageIds: string[] };

export type FunnelMetrics = {
  leadToContact: string;
  contactToAppointment: string;
  appointmentToEstimate: string;
  estimateToWon: string;
  leadToWon: string;
};

/** Stages that park a lead rather than advance it; they never count as progress. */
const PARKED = new Set(["On Hold"]);

const pct = (part: number, whole: number) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : "0");

export function computeFunnel(stages: FunnelStage[], leads: FunnelLead[]): { reached: Record<string, number>; metrics: FunnelMetrics } {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const progress = (id: string) => {
    const s = byId.get(id);
    return s && !s.isLost && !PARKED.has(s.name) ? s.stageOrder : -1;
  };
  const orderOf = (name: string) => stages.find((s) => s.name === name)?.stageOrder ?? null;
  const wonOrder = stages.find((s) => s.isWon)?.stageOrder ?? null;

  // The furthest progress stage each lead ever stood at.
  const furthest = leads.map((l) => Math.max(progress(l.currentStageId), ...l.visitedStageIds.map(progress)));
  const reachedAtLeast = (order: number | null) => (order === null ? 0 : furthest.filter((f) => f >= order).length);

  const total = leads.length;
  const contacted = reachedAtLeast(orderOf("Contacted"));
  const appointed = reachedAtLeast(orderOf("Appointment Scheduled"));
  const estimated = reachedAtLeast(orderOf("Estimate Sent"));
  const won = reachedAtLeast(wonOrder);

  return {
    reached: { total, contacted, appointed, estimated, won },
    metrics: {
      leadToContact: pct(contacted, total),
      contactToAppointment: pct(appointed, contacted),
      appointmentToEstimate: pct(estimated, appointed),
      estimateToWon: pct(won, estimated),
      leadToWon: pct(won, total),
    },
  };
}

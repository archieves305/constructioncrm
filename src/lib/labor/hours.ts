// Pure hours/overtime engine. All time math is integer minutes; conversion
// to 2-decimal hours happens only at the edges so pennies never drift.
//
// Overtime policy (LaborSettings): weekly threshold at otMultiplier (FLSA
// default 40h @ 1.5x), plus an optional per-day threshold applied first
// (off by default — Florida has no daily-OT statute). Weekly allocation
// runs over a worker's entries across ALL jobs for the week — true payroll
// semantics — filling regular time chronologically and spilling the
// remainder into OT on later entries.

export type OtSettings = {
  otWeeklyThreshold: number; // hours
  otDailyThreshold: number | null; // hours, null = disabled
  otMultiplier: number;
};

export type ShiftTimes = {
  startMinutes: number | null;
  endMinutes: number | null;
  breakMinutes: number;
};

/**
 * Worked minutes for one shift. endMinutes < startMinutes is treated as a
 * midnight-crossing shift (+24h). Missing start or end → 0.
 */
export function computeShiftMinutes(shift: ShiftTimes): number {
  const { startMinutes, endMinutes, breakMinutes } = shift;
  if (startMinutes == null || endMinutes == null) return 0;
  let end = endMinutes;
  if (end < startMinutes) end += 24 * 60;
  return Math.max(0, end - startMinutes - Math.max(0, breakMinutes));
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export type WeekEntry = {
  id: string;
  workDate: string; // YYYY-MM-DD
  minutes: number; // worked minutes (already net of break)
};

export type EntryHours = {
  regularHours: number;
  otHours: number;
  totalHours: number;
};

/**
 * Split one worker's week of entries into regular/OT hours per entry.
 * Entries are processed chronologically (ties broken by id for stability):
 * 1. Optional daily threshold: minutes past it on any single day are OT.
 * 2. Weekly threshold: cumulative day-regular minutes past it are OT.
 */
export function allocateWeeklyOvertime(
  entries: WeekEntry[],
  settings: OtSettings,
): Map<string, EntryHours> {
  const ordered = [...entries].sort(
    (a, b) => a.workDate.localeCompare(b.workDate) || a.id.localeCompare(b.id),
  );

  const weeklyLimit = Math.round(settings.otWeeklyThreshold * 60);
  const dailyLimit =
    settings.otDailyThreshold == null
      ? null
      : Math.round(settings.otDailyThreshold * 60);

  const result = new Map<string, EntryHours>();
  const dayRegularUsed = new Map<string, number>();
  let weekRegularUsed = 0;

  for (const entry of ordered) {
    let regular = entry.minutes;
    let ot = 0;

    if (dailyLimit != null) {
      const used = dayRegularUsed.get(entry.workDate) ?? 0;
      const dayRoom = Math.max(0, dailyLimit - used);
      const dayReg = Math.min(regular, dayRoom);
      ot += regular - dayReg;
      regular = dayReg;
      dayRegularUsed.set(entry.workDate, used + dayReg);
    }

    const weekRoom = Math.max(0, weeklyLimit - weekRegularUsed);
    const weekReg = Math.min(regular, weekRoom);
    ot += regular - weekReg;
    regular = weekReg;
    weekRegularUsed += weekReg;

    result.set(entry.id, {
      regularHours: minutesToHours(regular),
      otHours: minutesToHours(ot),
      totalHours: minutesToHours(entry.minutes),
    });
  }

  return result;
}

export function computeOtRate(regularRate: number, multiplier: number): number {
  return Math.round(regularRate * multiplier * 100) / 100;
}

export function computeEntryCost(input: {
  regularHours: number;
  otHours: number;
  regularRate: number;
  otRate: number;
}): number {
  const cost =
    input.regularHours * input.regularRate + input.otHours * input.otRate;
  return Math.round(cost * 100) / 100;
}

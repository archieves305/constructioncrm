/**
 * Pure AIA G702 arithmetic, shared by the server (progress-billing service,
 * PDF) and the browser (live preview in the new-application dialog). No
 * Prisma here — this file must stay importable from a client component.
 */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type SovLineInput = {
  id: string;
  itemNo: number;
  description: string;
  scheduledValue: number;
};

export type AppLineInput = { sovLineId: string; workCompleted: number };

export type ComputedLine = {
  sovLineId: string;
  itemNo: number;
  description: string;
  scheduledValue: number;
  previous: number;
  thisPeriod: number;
  toDate: number;
  /** fraction 0–1 of scheduled value completed to date */
  percent: number;
  balanceToFinish: number;
};

export type ComputedApplication = {
  lines: ComputedLine[];
  contractSum: number;
  completedPrevious: number;
  completedThisPeriod: number;
  completedToDate: number;
  retainagePercent: number;
  retainage: number;
  /** Retainage held after the previous application (its rate on the previous work). */
  previousRetainage: number;
  /** Net retainage handed back on this application (0 unless the rate was lowered). */
  retainageReleased: number;
  earnedLessRetainage: number;
  previousCertificates: number;
  currentDue: number;
  balanceToFinish: number;
};

/**
 * Pure G702 arithmetic for one application. `previousByLine` and
 * `previousCertificates` describe every earlier non-void application already
 * rolled up; `thisPeriod` is the work being billed now.
 *
 * Retainage release is the same arithmetic at a lower rate: an application
 * at 0% (or 5%) with no new work has current due = the retainage handed
 * back, because "earned less retainage" rises while "previous certificates"
 * stays put. `previousRetainagePercent` is the rate the last issued
 * application withheld at, so the release amount can be reported.
 */
export function computeApplication(input: {
  contractSum: number;
  retainagePercent: number;
  /** Rate on the previous application; defaults to this one's. */
  previousRetainagePercent?: number;
  sovLines: SovLineInput[];
  previousByLine: Record<string, number>;
  previousCertificates: number;
  thisPeriod: AppLineInput[];
}): ComputedApplication {
  const thisByLine = new Map<string, number>();
  for (const l of input.thisPeriod) {
    thisByLine.set(l.sovLineId, (thisByLine.get(l.sovLineId) ?? 0) + l.workCompleted);
  }

  const lines: ComputedLine[] = input.sovLines.map((s) => {
    const previous = round2(input.previousByLine[s.id] ?? 0);
    const thisPeriod = round2(thisByLine.get(s.id) ?? 0);
    const toDate = round2(previous + thisPeriod);
    return {
      sovLineId: s.id,
      itemNo: s.itemNo,
      description: s.description,
      scheduledValue: s.scheduledValue,
      previous,
      thisPeriod,
      toDate,
      percent: s.scheduledValue > 0 ? toDate / s.scheduledValue : 0,
      balanceToFinish: round2(s.scheduledValue - toDate),
    };
  });

  const completedPrevious = round2(lines.reduce((s, l) => s + l.previous, 0));
  const completedThisPeriod = round2(lines.reduce((s, l) => s + l.thisPeriod, 0));
  const completedToDate = round2(completedPrevious + completedThisPeriod);
  const retainage = round2(completedToDate * (input.retainagePercent / 100));
  const previousRate = input.previousRetainagePercent ?? input.retainagePercent;
  const previousRetainage = round2(completedPrevious * (previousRate / 100));
  const retainageReleased = Math.max(0, round2(previousRetainage - retainage));
  const earnedLessRetainage = round2(completedToDate - retainage);
  const previousCertificates = round2(input.previousCertificates);
  const currentDue = round2(earnedLessRetainage - previousCertificates);

  return {
    lines,
    contractSum: input.contractSum,
    completedPrevious,
    completedThisPeriod,
    completedToDate,
    retainagePercent: input.retainagePercent,
    retainage,
    previousRetainage,
    retainageReleased,
    earnedLessRetainage,
    previousCertificates,
    currentDue,
    balanceToFinish: round2(input.contractSum - completedToDate),
  };
}


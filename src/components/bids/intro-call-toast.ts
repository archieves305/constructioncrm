/** What a recorded submission says about the PM's follow-up call (`onBidSubmitted`). Client-safe. */
export type IntroCallToast = { raised: boolean; assigneeName: string | null; dueLabel: string | null };

/** " · Call task for Lisette, Mon 9:00 AM" — one per raised call; nothing when none was raised. */
export function introCallsLine(calls: (IntroCallToast | undefined)[]): string {
  const raised = calls.filter((c): c is IntroCallToast => !!c?.raised);
  if (raised.length === 0) return "";
  if (raised.length === 1) return ` · Call task for ${raised[0].assigneeName ?? "the bid's owner"}, ${raised[0].dueLabel}`;
  return ` · ${raised.length} call tasks raised for ${raised[0].dueLabel}`;
}

import { dayKey } from "@/lib/format";

/** "Never contacted", "Follow up today", "Follow up 3 days late", "Follow up Nov 12". */
export function followUpLine(nextFollowUpAt: string | null, lastContactAt: string | null, now: Date = new Date()): { text: string; late: boolean } {
  if (!lastContactAt && !nextFollowUpAt) return { text: "Never contacted", late: true };
  if (!nextFollowUpAt) return { text: "No follow-up set", late: false };
  const today = dayKey(now);
  const due = dayKey(new Date(nextFollowUpAt));
  if (due === today) return { text: "Follow up today", late: false };
  if (due < today) {
    const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000);
    return { text: `Follow up ${days} day${days === 1 ? "" : "s"} late`, late: true };
  }
  return { text: `Follow up ${new Date(`${due}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`, late: false };
}

/** The follow-up choices after a call, as office-day keys. */
export const FOLLOW_UP_CHOICES = [
  { key: "none", label: "Leave as is", days: null },
  { key: "1", label: "Tomorrow", days: 1 },
  { key: "3", label: "In 3 days", days: 3 },
  { key: "7", label: "Next week", days: 7 },
  { key: "14", label: "In 2 weeks", days: 14 },
] as const;

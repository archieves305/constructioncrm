import { redirect } from "next/navigation";

/**
 * `/schedule` was a week grid of jobs by crew. Nobody used it (zero jobs ever
 * carried a scheduledDate in prod) and its API had no role check. Scheduling
 * lives on the Calendar now; old bookmarks land there.
 */
export default function ScheduleRedirect() {
  redirect("/calendar");
}

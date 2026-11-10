/**
 * The crew mode of KNU Field: who gets it, and the plain choices a crew lead
 * makes when something goes wrong on site. Pure, so it is tested.
 */
export const CREW_ROLES = ["CREW_LEAD", "CREW_MEMBER"] as const;

export function isCrewRole(role: string | null | undefined): boolean {
  return (CREW_ROLES as readonly string[]).includes(role ?? "");
}

/** The foreman keeps the day's log, the crew sheet and tasks for others; a crew member contributes photos and problems. */
export function isForeman(role: string | null | undefined): boolean {
  return role !== "CREW_MEMBER";
}

export type ProblemKind = "materials" | "equipment" | "access" | "safety" | "blocked" | "condition" | "quality" | "other";

export const PROBLEMS: { kind: ProblemKind; label: string; icon: string }[] = [
  { kind: "safety", label: "Safety", icon: "medkit-outline" },
  { kind: "blocked", label: "Work blocked", icon: "hand-left-outline" },
  { kind: "materials", label: "Missing materials", icon: "cube-outline" },
  { kind: "equipment", label: "Equipment problem", icon: "construct-outline" },
  { kind: "access", label: "Can't get on site", icon: "lock-closed-outline" },
  { kind: "condition", label: "Unexpected condition", icon: "eye-outline" },
  { kind: "quality", label: "Quality problem", icon: "ribbon-outline" },
  { kind: "other", label: "Something else", icon: "chatbubble-ellipses-outline" },
];

/**
 * The field issue a problem becomes. Safety is always a SAFETY issue and at
 * least High; missing materials go to purchasing as a material request; a
 * quality problem is a punch item; the rest are office follow-ups. Urgent
 * raises any of them to Urgent.
 */
export function problemIssue(
  kind: ProblemKind,
  note: string,
  urgent: boolean,
): { type: "SAFETY" | "MATERIAL_REQUEST" | "PUNCH" | "OFFICE_FOLLOW_UP"; title: string; priority: "MEDIUM" | "HIGH" | "URGENT"; description?: string } {
  const label = PROBLEMS.find((p) => p.kind === kind)?.label ?? "Problem";
  const text = note.trim();
  const first = text.split("\n")[0].slice(0, 120);
  const title = first ? `${label}: ${first}` : label;
  const type = kind === "safety" ? "SAFETY" : kind === "materials" ? "MATERIAL_REQUEST" : kind === "quality" ? "PUNCH" : "OFFICE_FOLLOW_UP";
  const priority = urgent ? "URGENT" : kind === "safety" || kind === "blocked" || kind === "access" ? "HIGH" : "MEDIUM";
  return { type, title: title.slice(0, 200), priority, description: text.length > first.length ? text : undefined };
}

/** "7:30 AM" from minutes after midnight; null for no start time. */
export function startLabel(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes < 0 || minutes >= 24 * 60) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

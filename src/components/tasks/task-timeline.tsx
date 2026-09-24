"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";

/**
 * Renders the unified task history. Notes and system events share one table
 * server-side, so they share one component here — the whole point is that a
 * reader sees "Frank blocked this" and "Frank explained why" in one column,
 * in order.
 */

export type TimelineActor = { id: string; firstName: string; lastName: string } | null;

export type TimelineEvent = {
  id: string;
  type: string;
  body: string | null;
  fromValue: string | null;
  toValue: string | null;
  editedAt: string | null;
  createdAt: string;
  actor: TimelineActor;
};

export type UserLookup = Record<string, string>;

function actorName(actor: TimelineActor): string {
  if (!actor) return "The system";
  return `${actor.firstName} ${actor.lastName}`.trim() || "Someone";
}

function nameOf(userId: string | null, users: UserLookup): string {
  if (!userId) return "nobody";
  return users[userId] ?? "someone";
}

function prettyDate(iso: string | null): string {
  if (!iso) return "no date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "no date" : format(d, "MMM d, yyyy");
}

function statusLabel(v: string | null): string {
  const map: Record<string, string> = {
    PENDING: "Not started",
    IN_PROGRESS: "In progress",
    BLOCKED: "Blocked",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  };
  return v ? (map[v] ?? v) : "—";
}

/** One line of past tense, phrased the way someone would say it out loud. */
function describe(e: TimelineEvent, users: UserLookup): string | null {
  const who = actorName(e.actor);
  switch (e.type) {
    case "CREATED":
      return `${who} created this task`;
    case "ASSIGNED":
      return e.fromValue
        ? `${who} reassigned this from ${nameOf(e.fromValue, users)} to ${nameOf(e.toValue, users)}`
        : `${who} assigned this to ${nameOf(e.toValue, users)}`;
    case "UNASSIGNED":
      return `${who} unassigned this from ${nameOf(e.fromValue, users)}`;
    case "STATUS_CHANGED":
      return `${who} moved this from ${statusLabel(e.fromValue)} to ${statusLabel(e.toValue)}`;
    case "PRIORITY_CHANGED":
      return `${who} changed priority from ${e.fromValue ?? "—"} to ${e.toValue ?? "—"}`;
    case "DUE_CHANGED":
      return e.toValue
        ? `${who} set the due date to ${prettyDate(e.toValue)}`
        : `${who} cleared the due date`;
    case "BLOCKED":
      return `${who} marked this blocked${e.toValue ? ` — ${e.toValue}` : ""}`;
    case "UNBLOCKED":
      return `${who} unblocked this (${statusLabel(e.toValue)})`;
    case "WATCHER_ADDED":
      return `${who} added ${nameOf(e.toValue, users)} as a watcher`;
    case "WATCHER_REMOVED":
      return `${who} removed ${nameOf(e.toValue, users)} as a watcher`;
    case "EMAIL_SENT":
      return `Emailed ${e.toValue ?? "someone"}`;
    case "EMAIL_FAILED":
      return `Email to ${e.toValue ?? "someone"} failed${e.body ? ` — ${e.body}` : ""}`;
    case "NUDGED":
      return `${who} nudged ${nameOf(e.toValue, users)}${e.body ? ` — “${e.body}”` : ""}`;
    case "ESCALATED":
      return `Escalated to level ${e.toValue ?? "?"} — ${e.toValue === "1" ? "the person who raised it" : "the raiser and managers"} emailed${e.body ? ` (${e.body})` : ""}`;
    case "REMINDER_SET":
      return e.toValue ? `${who} set a reminder for ${prettyDate(e.toValue)}` : `${who} cleared the reminder`;
    case "REMINDER_SENT":
      return `Reminder emailed to ${e.toValue ?? "someone"}`;
    case "AUTO_CLOSED":
      return `${e.toValue === "COMPLETED" ? "Completed" : "Cancelled"} automatically${e.body ? ` — ${e.body}` : ""}`;
    case "ACTIVATED":
      return e.toValue === "initial"
        ? "Ready from the start — nothing to wait for"
        : e.toValue === "out_of_order"
          ? `${who} started this before its predecessors were done`
          : e.toValue === "reconcile"
            ? "Became ready after the workflow was re-planned"
            : "Became ready — its predecessors are done";
    case "SKIPPED":
      return `${who} skipped this step${e.body ? ` — ${e.body}` : ""}${e.toValue ? " (blocking gate overridden)" : ""}`;
    case "DEPENDENCY_ADDED":
      return `${who} made this wait on another step`;
    case "DEPENDENCY_REMOVED":
      return `${who} removed a dependency`;
    case "CHECKLIST_UPDATED":
      return `${who} updated the checklist${e.toValue ? ` (${e.toValue} done)` : ""}`;
    case "EVIDENCE_ATTACHED":
      return `${who} attached ${e.body ? `“${e.body}”` : "a file"}`;
    case "INSPECTION_RESULT":
      return `${who} recorded the inspection as ${e.toValue?.toLowerCase() ?? "—"}${e.body ? ` — ${e.body}` : ""}`;
    case "RECONCILED":
      return `Workflow re-planned${e.body ? ` — ${e.body}` : ""}`;
    default:
      return null;
  }
}

const DOT_TONE: Record<string, string> = {
  BLOCKED: "bg-amber-500",
  UNBLOCKED: "bg-blue-500",
  EMAIL_FAILED: "bg-red-500",
  EMAIL_SENT: "bg-gray-300",
  CREATED: "bg-gray-400",
  NUDGED: "bg-violet-500",
  ESCALATED: "bg-red-500",
  AUTO_CLOSED: "bg-emerald-500",
  REMINDER_SET: "bg-gray-300",
  REMINDER_SENT: "bg-gray-300",
  ACTIVATED: "bg-tone-info",
  SKIPPED: "bg-gray-400",
  EVIDENCE_ATTACHED: "bg-gray-400",
  INSPECTION_RESULT: "bg-tone-warning",
  RECONCILED: "bg-tone-info",
};

export function TaskTimeline({
  events,
  users,
  currentUserId,
  isAdmin,
  onEditNote,
  onDeleteNote,
}: {
  events: TimelineEvent[];
  users: UserLookup;
  currentUserId: string;
  isAdmin: boolean;
  onEditNote: (id: string, body: string) => void;
  onDeleteNote: (id: string) => void;
}) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing has happened on this task yet.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {events.map((e) => {
        if (e.type === "NOTE") {
          const mine = e.actor?.id === currentUserId;
          return (
            <li key={e.id} className="rounded-md border bg-white p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-gray-700">{actorName(e.actor)}</span>
                <span>{format(new Date(e.createdAt), "MMM d, h:mm a")}</span>
                {e.editedAt && <span className="italic">edited</span>}
                <span className="flex-1" />
                {mine && (
                  <button
                    type="button"
                    className="hover:text-foreground hover:underline"
                    onClick={() => onEditNote(e.id, e.body ?? "")}
                  >
                    Edit
                  </button>
                )}
                {(mine || isAdmin) && (
                  <button
                    type="button"
                    className="hover:text-red-600 hover:underline"
                    onClick={() => onDeleteNote(e.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{e.body}</p>
            </li>
          );
        }

        const text = describe(e, users);
        if (!text) return null;
        const muted = e.type === "EMAIL_SENT";

        return (
          <li key={e.id} className="flex items-start gap-2 px-1 text-xs">
            <span
              className={cn(
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                DOT_TONE[e.type] ?? "bg-gray-300",
              )}
            />
            <span
              className={cn(
                "flex-1",
                muted ? "text-muted-foreground/70" : "text-muted-foreground",
                e.type === "EMAIL_FAILED" && "text-red-600",
              )}
            >
              {text}
            </span>
            <span className="shrink-0 text-muted-foreground/70">
              {format(new Date(e.createdAt), "MMM d, h:mm a")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

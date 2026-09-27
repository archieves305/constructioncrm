import type { DeliveryClass, NotificationCategory, NotificationEmailMode, RoleName } from "@/generated/prisma/client";
import type { RecipientReason } from "@/lib/tasks/recipients";
import { KINDS, type NotificationKind, type Signals } from "./kinds";

/**
 * How one notification reaches one person. Pure: everything it needs is
 * passed in, so every rule has a test and "why didn't I get an email?" is
 * answerable from the row it produces (`classifyReason`, `demotedReason`).
 *
 * Order of precedence, first match wins for the base class, then the user's
 * mode, then the safety demotions:
 *   forced → registry NONE → actor receipt → admin overrides → registry
 *   default + upgrade rule → user mode / muted category → batch, cap, storm.
 */

export type ClassifyRecipient = {
  role: RoleName;
  /** Active, has an email address. */
  emailAllowed: boolean;
  emailMode: NotificationEmailMode;
  mutedCategories: NotificationCategory[];
};

export type ClassifySettings = {
  immediateKinds: string[];
  digestOnlyKinds: string[];
  maxImmediatePerUserPerHour: number;
  batchCollapseThreshold: number;
};

export type ClassifyInput = {
  kind: NotificationKind;
  reason: RecipientReason;
  recipient: ClassifyRecipient;
  signals: Signals;
  settings: ClassifySettings;
  /** IMMEDIATE rows already created for this recipient in the last hour. */
  immediateCountLastHour: number;
  stormActive: boolean;
  /** Rows the caller is creating in this same engine run (1 when not batched). */
  batchSize: number;
  forceClass?: DeliveryClass | null;
  now: Date;
  tz: string;
};

export type DemotedReason = "immediate-cap" | "storm" | "batch";

export type Classification = {
  deliveryClass: DeliveryClass;
  reason: string;
  demotedFrom?: DeliveryClass;
  demotedReason?: DemotedReason;
};

/** Managers asked for escalations; those survive an in-app-only mode (not a muted category). */
function managerEscalation(kind: NotificationKind, reason: RecipientReason): boolean {
  return (kind === "task.escalated" || kind === "case.escalated") && reason === "manager";
}

export function classify(i: ClassifyInput): Classification {
  const spec = KINDS[i.kind];

  if (i.forceClass) return { deliveryClass: i.forceClass, reason: "forced by caller" };
  if (spec.defaultClass === "NONE") return { deliveryClass: "NONE", reason: "registry: no notification" };
  if (i.reason === "actor") return { deliveryClass: "IN_APP_ONLY", reason: "own action: bell receipt only" };

  // Base class.
  let cls: DeliveryClass = spec.defaultClass;
  let reason = `registry default ${spec.defaultClass}`;
  if (i.settings.immediateKinds.includes(i.kind)) {
    cls = "IMMEDIATE";
    reason = "admin: always immediate";
  } else if (i.settings.digestOnlyKinds.includes(i.kind)) {
    cls = cls === "IMMEDIATE" ? "DIGEST" : cls;
    reason = "admin: never immediate";
  } else if (cls === "DIGEST" && spec.immediateWhen) {
    const why = spec.immediateWhen(i.signals, i.reason, { now: i.now, tz: i.tz });
    if (why) {
      cls = "IMMEDIATE";
      reason = `upgraded: ${why}`;
    }
  }

  // The person's own choices.
  if (cls === "IMMEDIATE" || cls === "DIGEST") {
    if (!i.recipient.emailAllowed) return { deliveryClass: "IN_APP_ONLY", reason: `${reason}; no email address` };
    if (i.recipient.mutedCategories.includes(spec.category)) {
      return { deliveryClass: "IN_APP_ONLY", reason: `${reason}; category ${spec.category} muted` };
    }
    if (i.recipient.emailMode === "IN_APP_ONLY" && !managerEscalation(i.kind, i.reason)) {
      return { deliveryClass: "IN_APP_ONLY", reason: `${reason}; user is in-app only` };
    }
    if (i.recipient.emailMode === "IMMEDIATE" && cls === "DIGEST") {
      cls = "IMMEDIATE";
      reason = `${reason}; user wants everything immediately`;
    }
  }

  // Safety valves. Person-to-person and emergency kinds are exempt.
  if (cls === "IMMEDIATE" && !spec.neverDemote) {
    if (i.batchSize >= i.settings.batchCollapseThreshold) {
      return { deliveryClass: "DIGEST", reason, demotedFrom: "IMMEDIATE", demotedReason: "batch" };
    }
    if (i.immediateCountLastHour >= i.settings.maxImmediatePerUserPerHour) {
      return { deliveryClass: "DIGEST", reason, demotedFrom: "IMMEDIATE", demotedReason: "immediate-cap" };
    }
    if (i.stormActive) {
      return { deliveryClass: "DIGEST", reason, demotedFrom: "IMMEDIATE", demotedReason: "storm" };
    }
  }

  return { deliveryClass: cls, reason };
}

/** Whether a row of this kind should be flagged as needing action for this recipient. */
export function isActionRequired(kind: NotificationKind, signals: Signals, reason: RecipientReason): boolean {
  return KINDS[kind].actionRequired(signals, reason);
}

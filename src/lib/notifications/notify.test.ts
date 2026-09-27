import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const db = vi.hoisted(() => ({
  notification: { create: vi.fn(), update: vi.fn() },
}));
const gates = vi.hoisted(() => ({ recording: true, enabled: false }));
const resolveRecipients = vi.hoisted(() => vi.fn());
const deliverImmediate = vi.hoisted(() => vi.fn());
const recordTaskEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent: (...a: unknown[]) => recordTaskEvent(...a) }));
vi.mock("@/lib/tasks/recipients", () => ({ resolveRecipients: (...a: unknown[]) => resolveRecipients(...a) }));
vi.mock("./deliver-immediate", () => ({ deliverImmediate: (...a: unknown[]) => deliverImmediate(...a) }));
vi.mock("./storm", () => ({ immediateCounts: async () => new Map(), stormActive: async () => false }));
vi.mock("./settings", () => ({
  isNotificationsV2Recording: () => gates.recording,
  isDeliveryTakenOver: () => gates.recording && gates.enabled,
  loadNotificationSettings: async () => ({
    enabled: gates.enabled,
    timeZone: "America/New_York",
    digestWindows: ["08:00", "12:00", "15:30", "18:00"],
    weekdaysOnly: true,
    catchUpGraceMinutes: 90,
    immediateKinds: [],
    digestOnlyKinds: [],
    maxImmediatePerUserPerHour: 6,
    batchCollapseThreshold: 3,
    stormThresholdPer10Min: 40,
  }),
  classifySettingsOf: (s: { immediateKinds: string[]; digestOnlyKinds: string[]; maxImmediatePerUserPerHour: number; batchCollapseThreshold: number }) => ({
    immediateKinds: s.immediateKinds,
    digestOnlyKinds: s.digestOnlyKinds,
    maxImmediatePerUserPerHour: s.maxImmediatePerUserPerHour,
    batchCollapseThreshold: s.batchCollapseThreshold,
  }),
  windowSettingsOf: (s: { timeZone: string; digestWindows: string[]; weekdaysOnly: boolean; catchUpGraceMinutes: number }) => ({
    timeZone: s.timeZone,
    digestWindows: s.digestWindows,
    weekdaysOnly: s.weekdaysOnly,
    catchUpGraceMinutes: s.catchUpGraceMinutes,
  }),
}));

const { notify } = await import("./notify");

const recipient = (userId: string, over: Record<string, unknown> = {}) => ({
  userId,
  email: `${userId}@knuco.com`,
  firstName: "T",
  lastName: "U",
  role: "SALES_REP",
  reason: "assignee",
  emailAllowed: true,
  emailBlock: null,
  emailMode: "DIGEST",
  mutedCategories: [],
  digestWindows: [],
  ...over,
});

// Tuesday 2026-10-06 10:00 New York.
const NOW = new Date("2026-10-06T14:00:00Z");

const base = {
  kind: "task.assigned" as const,
  candidates: [{ userId: "u-a", reason: "assignee" as const }],
  actorUserId: "u-actor",
  subject: { type: "task" as const, taskId: "t1", jobId: "j1" },
  title: "Order dumpster",
  href: "/tasks?task=t1",
  occurredAt: NOW,
  immediateRender: () => ({ subject: "s", html: "<p>h</p>", text: "t" }),
};

beforeEach(() => {
  gates.recording = true;
  gates.enabled = false;
  db.notification.create.mockReset().mockResolvedValue({ id: "n1" });
  db.notification.update.mockReset().mockResolvedValue({ id: "n1" });
  resolveRecipients.mockReset().mockResolvedValue({ recipients: [recipient("u-a")], skipped: [] });
  deliverImmediate.mockReset().mockResolvedValue(true);
  recordTaskEvent.mockReset().mockResolvedValue(undefined);
});

describe("notify: gates", () => {
  it("with the env flag off it touches nothing and tells the caller to mail as before", async () => {
    gates.recording = false;
    const r = await notify(base);
    expect(r).toMatchObject({ legacy: true, takeover: false, rows: [] });
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("shadow mode records a SUPPRESSED digest row, sends nothing, and still says legacy", async () => {
    const r = await notify(base);
    expect(r.legacy).toBe(true);
    expect(r.rows).toEqual([{ id: "n1", userId: "u-a", deliveryClass: "DIGEST", created: true }]);
    const data = db.notification.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      recipientUserId: "u-a",
      kind: "task.assigned",
      category: "TASKS",
      deliveryClass: "DIGEST",
      state: "SUPPRESSED",
      scheduledWindowKey: "2026-10-06:12:00",
      dedupeKey: "task.assigned:task:t1:2026-10-06:12:00",
      lastError: "shadow: legacy path mailed",
    });
    expect(deliverImmediate).not.toHaveBeenCalled();
    expect(recordTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", type: "NOTIFIED", toValue: "u-a", body: "task.assigned → DIGEST" }));
  });

  it("with both gates on a digest row waits PENDING and the caller stands down", async () => {
    gates.enabled = true;
    const r = await notify(base);
    expect(r.legacy).toBe(false);
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ state: "PENDING", deliveryClass: "DIGEST" });
  });

  it("with both gates on an immediate row is delivered with the caller's renderer", async () => {
    gates.enabled = true;
    await notify({ ...base, kind: "task.mentioned" });
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ deliveryClass: "IMMEDIATE", state: "PENDING", scheduledWindowKey: null });
    expect(deliverImmediate).toHaveBeenCalledWith(expect.objectContaining({ rowId: "n1", kind: "task.mentioned", href: "/tasks?task=t1", taskId: "t1" }));
  });

  it("a row the caller already mailed is recorded as SENT and not sent again", async () => {
    gates.enabled = true;
    await notify({ ...base, kind: "task.escalated", delivered: { emailedAt: NOW, providerMessageId: "m1" } });
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ state: "SENT", emailedAt: NOW, providerMessageId: "m1" });
    expect(deliverImmediate).not.toHaveBeenCalled();
  });
});

describe("notify: recipients and dedupe", () => {
  it("an in-app-only row is SENT on creation (it exists in the bell)", async () => {
    gates.enabled = true;
    await notify({ ...base, kind: "lead.new", forceClass: "IN_APP_ONLY" });
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ deliveryClass: "IN_APP_ONLY", state: "SENT", dedupeKey: "lead.new:task:t1:inapp:2026-10-06" });
  });

  it("the actor is a bell receipt when the caller keeps them", async () => {
    gates.enabled = true;
    resolveRecipients.mockResolvedValue({ recipients: [recipient("u-actor", { reason: "assignee" }), recipient("u-w", { reason: "watcher" })], skipped: [] });
    const r = await notify({ ...base, kind: "task.completed", suppressActor: false });
    expect(resolveRecipients).toHaveBeenCalledWith(expect.objectContaining({ suppressUserId: null, includeMuted: true }));
    const rows = db.notification.create.mock.calls.map((c) => c[0].data);
    expect(rows.find((d) => d.recipientUserId === "u-actor")).toMatchObject({ recipientReason: "actor", deliveryClass: "IN_APP_ONLY" });
    expect(rows.find((d) => d.recipientUserId === "u-w")).toMatchObject({ recipientReason: "watcher", deliveryClass: "DIGEST" });
    expect(r.rows).toHaveLength(2);
  });

  it("a repeat of the same event in the same window bumps the existing row instead of adding one", async () => {
    gates.enabled = true;
    db.notification.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
    const r = await notify(base);
    expect(r.deduped).toBe(1);
    expect(r.rows[0]).toMatchObject({ id: "n1", created: false });
    expect(db.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipientUserId_dedupeKey: { recipientUserId: "u-a", dedupeKey: "task.assigned:task:t1:2026-10-06:12:00" } },
      data: expect.objectContaining({ occurrences: { increment: 1 }, readAt: null }),
    }));
    expect(recordTaskEvent).not.toHaveBeenCalled();
    expect(deliverImmediate).not.toHaveBeenCalled();
  });

  it("a batch of three demotes an urgent assignment to the digest and records why", async () => {
    gates.enabled = true;
    await notify({ ...base, signals: { taskPriority: "URGENT" }, batch: { key: "wf-apply:i1:1", size: 3 } });
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ deliveryClass: "DIGEST", demotedFrom: "IMMEDIATE", demotedReason: "batch", batchKey: "wf-apply:i1:1" });
    expect(deliverImmediate).not.toHaveBeenCalled();
  });

  it("a person with no email gets the bell row only", async () => {
    gates.enabled = true;
    resolveRecipients.mockResolvedValue({ recipients: [recipient("u-a", { emailAllowed: false, emailBlock: "no-email", email: "" })], skipped: [] });
    await notify({ ...base, kind: "task.mentioned" });
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ deliveryClass: "IN_APP_ONLY", state: "SENT" });
    expect(deliverImmediate).not.toHaveBeenCalled();
  });

  it("never throws: a database failure falls back to the legacy path", async () => {
    db.notification.create.mockRejectedValue(new Error("db down"));
    const r = await notify(base);
    expect(r.legacy).toBe(true);
  });
});

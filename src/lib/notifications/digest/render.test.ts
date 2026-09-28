import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { APP_BASE_URL: "https://crm.test", NOTIFICATIONS_V2: "1" } }));

const { digestSubject, renderDigestEmail } = await import("./render");
const { buildDigest } = await import("./build");
import type { DigestRowInput } from "./build";

const brand = { companyName: "Knu Construction", primaryColor: "#2b4c7e" } as unknown as import("@/lib/email/brand").EmailBrand;
const job = { key: "job:j1", label: "7676 Peters Road", code: "JOB-00012", href: "/jobs/j1" };
let n = 0;
const row = (over: Partial<DigestRowInput> = {}): DigestRowInput => ({
  id: `r${++n}`, kind: "task.assigned", title: `Task ${n}`, body: null, href: `/tasks?task=t${n}`, priority: "MEDIUM", actionRequired: false, recipientReason: "assignee",
  subjectType: "task", subjectId: `t${n}`, taskId: `t${n}`, batchKey: null, occurrences: 1, lastOccurredAt: new Date("2026-09-28T13:00:00Z"), subject: job, ...over,
});
const opts = { role: "ADMIN" as const, maxPerSection: 12, maxPerSubject: 6, batchCollapseThreshold: 3 };

describe("digestSubject", () => {
  it("names the one action item, else counts, never says 'new notifications'", () => {
    const one = buildDigest([row({ kind: "task.blocked", title: "Permit gate", actionRequired: true })], opts);
    expect(digestSubject(one, null, "midday")).toBe("Blocked: Permit gate at 7676 Peters Road — Midday digest");
    const many = buildDigest([row({ kind: "task.blocked", actionRequired: true }), row({ kind: "task.blocked", actionRequired: true }), row({ kind: "task.completed" })], opts);
    expect(digestSubject(many, null, "afternoon")).toBe("2 to action · 1 update — Afternoon digest");
    const updates = buildDigest([row({ kind: "task.completed" }), row({ kind: "task.completed" })], opts);
    expect(digestSubject(updates, null, "evening")).toBe("2 updates on your jobs — End-of-day digest");
    const agendaOnly = buildDigest([], opts);
    expect(digestSubject(agendaOnly, { heading: "Today", items: [{ title: "x", when: "All day", context: "c", href: "/t", tone: "today" }], changes: [], starting: [] }, "morning")).toBe("Your morning: 1 scheduled — Morning digest");
    expect(digestSubject(agendaOnly, null, "morning")).not.toMatch(/notifications/i);
  });
  it("stays within 78 characters", () => {
    const long = buildDigest([row({ kind: "task.blocked", actionRequired: true, title: "A very long task title that goes on and on about shingles and flashing details" })], opts);
    expect(digestSubject(long, null, "midday").length).toBeLessThanOrEqual(78);
  });
});

describe("renderDigestEmail", () => {
  it("renders sections, resolves links per role, and links to the activity page", () => {
    const model = buildDigest([row({ kind: "task.assigned" }), row({ kind: "task.completed", recipientReason: "owner" })], opts);
    const since = new Date("2026-09-28T12:00:00Z");
    const office = renderDigestEmail({ recipientFirstName: "Richard", role: "ADMIN", slot: "midday", model, agenda: null, since, brand });
    expect(office.html).toContain("Assigned to you");
    expect(office.html).toContain("Completed work");
    expect(office.html).toContain("https://crm.test/tasks?task=t");
    expect(office.html).toContain(`https://crm.test/notifications?since=${encodeURIComponent(since.toISOString())}`);
    expect(office.text).toContain("ASSIGNED TO YOU (1):");
    const crew = renderDigestEmail({ recipientFirstName: "Frank", role: "CREW_LEAD", slot: "midday", model: buildDigest([row()], { ...opts, role: "CREW_LEAD" }), agenda: null, since, brand });
    expect(crew.html).toContain("https://crm.test/field/tasks/t");
    expect(crew.html).not.toContain("/tasks?task=");
  });
  it("puts the agenda first in the morning", () => {
    const model = buildDigest([row()], opts);
    const agenda = { heading: "Today", items: [{ title: "Pour footings", when: "8:00 – 9:00 AM", context: "12 Palm Ct", href: "/tasks?task=a", tone: "today" as const }], changes: [{ title: "Walk the site", from: "Tue, Sep 29", to: "Thu, Oct 1", byName: "Lisette Perez", href: "/tasks?task=b" }], starting: [{ title: "Roof — 12 Palm Ct", href: "/jobs/j1" }] };
    const out = renderDigestEmail({ recipientFirstName: "Richard", role: "ADMIN", slot: "morning", model, agenda, since: new Date(), brand });
    expect(out.html.indexOf("Starting today")).toBeLessThan(out.html.indexOf("Assigned to you"));
    expect(out.html).toContain("Schedule changed since yesterday");
    expect(out.text).toContain("Tue, Sep 29 → Thu, Oct 1 (moved by Lisette Perez)");
  });
});

import { describe, expect, it } from "vitest";
import type { EmailBrand } from "@/lib/email/brand";
import {
  renderTaskAssignedEmail,
  renderTaskCompletedEmail,
  renderTaskReminderEmail,
  type TaskEmailTask,
  renderTaskNudgeEmail,
  renderTaskEscalationEmail,
} from "./task-email";

const brand: EmailBrand = {
  id: "default",
  companyName: "Knu Construction",
  addressLine1: "2500 N Federal Highway, Suite 102",
  addressLine2: null,
  city: "Ft Lauderdale",
  state: "FL",
  zip: "33305",
  officePhone: "(561) 910-0142",
  mobilePhone: null,
  contactEmail: null,
  website: null,
  logoUrl: null,
  primaryColor: "#1f2937",
  signatureHtml: null,
  signatureText: null,
};

const NOW = new Date("2026-08-03T12:00:00Z");

const task: TaskEmailTask = {
  id: "t1",
  title: "Order roofing materials",
  description: "Shingles + underlayment for the back slope",
  status: "PENDING",
  priority: "HIGH",
  dueAt: new Date("2026-08-10T12:00:00Z"),
  blockedReason: null,
  job: { jobNumber: "J-1042", title: "Rodriguez re-roof" },
  lead: null,
  assignedTo: { firstName: "Frank", lastName: "Ruiz" },
  createdBy: { firstName: "Jo", lastName: "Garcia" },
  completedBy: null,
};

describe("renderTaskAssignedEmail", () => {
  const rendered = renderTaskAssignedEmail({
    task,
    recipientFirstName: "Frank",
    actorName: "Jo Garcia",
    url: "https://crm.careyos.com/tasks?task=t1",
    brand,
    now: NOW,
  });

  it("puts the task title in the subject", () => {
    expect(rendered.subject).toContain("Order roofing materials");
  });

  it("flags URGENT in the subject so it survives a crowded inbox", () => {
    const urgent = renderTaskAssignedEmail({
      task: { ...task, priority: "URGENT" },
      recipientFirstName: "Frank",
      actorName: "Jo Garcia",
      url: "https://crm.careyos.com/tasks?task=t1",
      brand,
      now: NOW,
    });
    expect(urgent.subject.startsWith("[URGENT]")).toBe(true);
    expect(rendered.subject.startsWith("[URGENT]")).toBe(false);
  });

  it("carries the branded shell, not a bespoke one", () => {
    expect(rendered.html).toContain("Knu Construction");
    expect(rendered.html).toContain(brand.primaryColor);
  });

  it("includes the CTA link and the job context", () => {
    expect(rendered.html).toContain("https://crm.careyos.com/tasks?task=t1");
    expect(rendered.html).toContain("J-1042");
  });

  it("names the job by its address when the lead carries one, number alongside", () => {
    const withAddress = renderTaskAssignedEmail({
      task: { ...task, job: { jobNumber: "J-1042", title: "Rodriguez re-roof", lead: { fullName: "Ana Rodriguez", propertyAddress1: "12 Palm Ct", city: "Miami" } } },
      recipientFirstName: "Frank",
      actorName: "Jo Garcia",
      url: "https://crm.careyos.com/tasks?task=t1",
      brand,
      now: NOW,
    });
    expect(withAddress.html).toContain("12 Palm Ct, Miami — Ana Rodriguez (J-1042)");
  });

  it("always ships a plain-text alternate", () => {
    expect(rendered.text).toContain("Order roofing materials");
    expect(rendered.text).toContain("https://crm.careyos.com/tasks?task=t1");
    expect(rendered.text).not.toContain("<table");
  });

  it("escapes HTML in user-supplied text", () => {
    const nasty = renderTaskAssignedEmail({
      task: { ...task, title: "Fix <script>alert(1)</script> flashing" },
      recipientFirstName: "Frank",
      actorName: "Jo Garcia",
      url: "https://crm.careyos.com/tasks?task=t1",
      brand,
      now: NOW,
    });
    expect(nasty.html).not.toContain("<script>");
    expect(nasty.html).toContain("&lt;script&gt;");
  });

  it("marks a task overdue when its due date has passed", () => {
    const late = renderTaskAssignedEmail({
      task: { ...task, dueAt: new Date("2026-07-01T12:00:00Z") },
      recipientFirstName: "Frank",
      actorName: "Jo Garcia",
      url: "https://x/",
      brand,
      now: NOW,
    });
    expect(late.html).toContain("Overdue");
    expect(late.text).toContain("OVERDUE");
  });

  it("does not call a completed task overdue", () => {
    const done = renderTaskAssignedEmail({
      task: { ...task, status: "COMPLETED", dueAt: new Date("2026-07-01T12:00:00Z") },
      recipientFirstName: "Frank",
      actorName: "Jo Garcia",
      url: "https://x/",
      brand,
      now: NOW,
    });
    expect(done.text).not.toContain("OVERDUE");
  });
});

describe("renderTaskCompletedEmail", () => {
  it("credits whoever actually completed it, not the assignee", () => {
    const rendered = renderTaskCompletedEmail({
      task: {
        ...task,
        status: "COMPLETED",
        completedBy: { firstName: "Dana", lastName: "Wu" },
      },
      recipientFirstName: "Jo",
      actorName: "Dana Wu",
      url: "https://x/",
      brand,
      notes: [],
      now: NOW,
    });
    expect(rendered.html).toContain("Dana Wu");
    expect(rendered.subject).toBe("Task completed: Order roofing materials");
  });

  it("inlines recent notes so the assignor gets the story without clicking", () => {
    const rendered = renderTaskCompletedEmail({
      task: { ...task, status: "COMPLETED" },
      recipientFirstName: "Jo",
      actorName: "Frank Ruiz",
      url: "https://x/",
      brand,
      notes: [
        {
          authorName: "Frank Ruiz",
          body: "Supplier was short, used the alternate",
          createdAt: new Date("2026-08-02T15:00:00Z"),
        },
      ],
      now: NOW,
    });
    expect(rendered.html).toContain("Supplier was short");
    expect(rendered.text).toContain("Supplier was short");
  });
});

describe("renderTaskReminderEmail", () => {
  const item = {
    title: "Order roofing materials",
    priority: "HIGH" as const,
    dueAt: new Date("2026-08-01T12:00:00Z"),
    context: "J-1042 — Rodriguez re-roof",
    url: "https://x/1",
    overdue: true,
  };

  it("leads with the overdue count when anything is overdue", () => {
    const rendered = renderTaskReminderEmail({
      recipientFirstName: "Frank",
      overdue: [item],
      dueToday: [],
      brand,
    });
    expect(rendered.subject).toContain("1 overdue task");
  });

  it("falls back to a due-today subject when nothing is overdue", () => {
    const rendered = renderTaskReminderEmail({
      recipientFirstName: "Frank",
      overdue: [],
      dueToday: [{ ...item, overdue: false }],
      brand,
    });
    expect(rendered.subject).toBe("1 task due today");
  });

  it("lists every task once, in one email", () => {
    const rendered = renderTaskReminderEmail({
      recipientFirstName: "Frank",
      overdue: [item, { ...item, title: "Call the inspector", url: "https://x/2" }],
      dueToday: [],
      brand,
    });
    expect(rendered.html).toContain("https://x/1");
    expect(rendered.html).toContain("https://x/2");
    expect(rendered.subject).toContain("2 overdue");
  });
});

describe("renderTaskNudgeEmail", () => {
  it("names the actor in the subject and quotes an escaped message", () => {
    const out = renderTaskNudgeEmail({
      task,
      recipientFirstName: "Frank",
      actorName: "Jo Garcia",
      url: "https://crm.example.com/tasks?task=t1",
      brand,
      message: "Customer is asking <today>",
    });
    expect(out.subject).toBe(`Jo Garcia is checking in on: ${task.title}`);
    expect(out.html).toContain("Customer is asking &lt;today&gt;");
    expect(out.html).not.toContain("<today>");
    expect(out.text).toContain("> Customer is asking <today>");
    expect(out.text).toContain("https://crm.example.com/tasks?task=t1");
  });
  it("has no quote block without a message", () => {
    const out = renderTaskNudgeEmail({ task, recipientFirstName: "Frank", actorName: "Jo", url: "https://x/y", brand });
    expect(out.html).not.toContain("#f5f3ff");
  });
});

describe("renderTaskEscalationEmail", () => {
  const item = {
    title: "Order shingles",
    assigneeName: "Frank Ruiz",
    daysOverdue: 3,
    dueAt: new Date("2026-09-21T12:00:00Z"),
    priority: "HIGH" as const,
    level: 1,
    context: "JOB-00012 — Roof",
    url: "https://x/tasks?task=t1",
    lastNote: { authorName: "Frank Ruiz", body: "Waiting on supplier", createdAt: new Date("2026-09-22T12:00:00Z") },
  };
  it("singular subject names the task and assignee", () => {
    const out = renderTaskEscalationEmail({
      recipientFirstName: "Jo",
      recipientReason: "assignor",
      items: [item],
      managerThresholdDays: 5,
      brand,
    });
    expect(out.subject).toBe("Overdue 3 days: Order shingles (Frank Ruiz)");
    expect(out.html).toContain("3d overdue");
    expect(out.html).toContain("Waiting on supplier");
    expect(out.html).toContain("You raised these");
  });
  it("plural subject counts, and managers get the manager wording", () => {
    const out = renderTaskEscalationEmail({
      recipientFirstName: "Sarah",
      recipientReason: "manager",
      items: [item, { ...item, title: "Call inspector", lastNote: null }],
      managerThresholdDays: 5,
      brand,
    });
    expect(out.subject).toBe("2 overdue tasks need attention");
    expect(out.html).toContain("overdue for 5+ days");
    expect(out.html).toContain("No notes yet");
    expect(out.text).toContain("Call inspector");
  });
});

describe("renderTaskReminderEmail — custom reminders", () => {
  const base = { priority: "MEDIUM" as const, dueAt: null, context: "JOB-00012 — Roof", url: "https://x", overdue: false };
  it("reminders-only mail has its own subject and wording for setter vs assignee", () => {
    const out = renderTaskReminderEmail({
      recipientFirstName: "Frank",
      overdue: [],
      dueToday: [],
      reminders: [
        { ...base, title: "Check permit status", setByName: "Jo Garcia" },
        { ...base, title: "Call the HOA", setByName: null },
      ],
      brand,
    });
    expect(out.subject).toBe("2 reminders for today");
    expect(out.html).toContain("Jo Garcia asked you to be reminded");
    expect(out.html).toContain("You asked to be reminded");
    expect(out.text).toContain("REMINDERS (2)");
  });
  it("a single reminder is subject-lined by title, and mixes into a digest as a suffix", () => {
    const one = renderTaskReminderEmail({
      recipientFirstName: "Frank",
      overdue: [],
      dueToday: [],
      reminders: [{ ...base, title: "Call the HOA", setByName: null }],
      brand,
    });
    expect(one.subject).toBe("Reminder: Call the HOA");
    const mixed = renderTaskReminderEmail({
      recipientFirstName: "Frank",
      overdue: [{ ...base, title: "Late thing", overdue: true }],
      dueToday: [],
      reminders: [{ ...base, title: "Call the HOA", setByName: null }],
      brand,
    });
    expect(mixed.subject).toBe("1 overdue task and 1 reminder");
  });
});

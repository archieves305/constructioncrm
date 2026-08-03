import { describe, expect, it } from "vitest";
import type { EmailBrand } from "@/lib/email/brand";
import {
  renderTaskAssignedEmail,
  renderTaskCompletedEmail,
  renderTaskReminderEmail,
  type TaskEmailTask,
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

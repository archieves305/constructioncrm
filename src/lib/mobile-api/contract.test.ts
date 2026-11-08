import { describe, expect, it } from "vitest";
import type { CalendarItem } from "@/lib/calendar/types";
import { makeItem } from "@/lib/calendar/test-fixtures";
import { calendarItem, calendarRange } from "./index";

/**
 * The phone app parses CRM responses with these schemas. If a change to the
 * CRM's calendar types would make the app reject a response, this fails here,
 * in the CRM's own test run, before the app ever sees it.
 */

// Compile-time: every field the app reads exists on the server's type. A
// schema field the server does not send makes `Missing` non-empty and the
// typecheck fails.
type Missing = Exclude<keyof ReturnType<typeof calendarItem.parse>, keyof CalendarItem>;
const noMissingFields: [Missing] extends [never] ? true : false = true;
void noMissingFields;

describe("calendar contract", () => {
  it("parses a plain task", () => {
    expect(calendarItem.safeParse(makeItem()).success).toBe(true);
  });

  it("parses a job task with its address", () => {
    const item = makeItem({
      job: {
        id: "j1",
        jobNumber: "JOB-00009",
        title: "Roofing — 3310 NE 37 St",
        serviceType: "roofing",
        lead: {
          id: "l1",
          fullName: "Ana Diaz",
          companyName: null,
          propertyAddress1: "3310 NE 37 St",
          propertyAddress2: null,
          city: "Fort Lauderdale",
          state: "FL",
          zipCode: "33308",
          primaryPhone: "954-555-0100",
        },
      },
    });
    const parsed = calendarItem.parse(item);
    expect(parsed.job?.lead?.propertyAddress1).toBe("3310 NE 37 St");
  });

  it("parses a read-only overlay and a blocked, timed task", () => {
    const overlay = makeItem({
      kind: "permit_inspection",
      id: "insp:1",
      overlay: { label: "Inspection", detail: "Final roofing", href: "/permits/p1", state: "scheduled" },
    });
    const blocked = makeItem({
      status: "BLOCKED",
      derived: "blocked",
      blockedReason: "Waiting on the truss delivery",
      allDay: false,
      scheduledStart: "2026-09-29T13:00:00.000Z",
      dueAt: "2026-09-29T15:00:00.000Z",
    });
    const range = calendarRange.safeParse({
      range: { from: "2026-09-29", to: "2026-09-29", timeZone: "America/New_York" },
      truncated: false,
      items: [overlay, blocked] satisfies CalendarItem[],
    });
    expect(range.success).toBe(true);
  });
});

describe("create-task contract", () => {
  it("every phone create request is a valid CRM create request", async () => {
    const { createTaskSchema } = await import("@/lib/validators/task");
    const { createTaskRequest } = await import("./index");
    const samples = [
      { title: "Check drywall" },
      { title: "Check drywall", jobId: "j1", assignedUserId: "u1", dueAt: "2026-11-09", priority: "HIGH" as const },
    ];
    for (const s of samples) {
      expect(createTaskRequest.safeParse(s).success).toBe(true);
      expect(createTaskSchema.safeParse(s).success).toBe(true);
    }
  });
});

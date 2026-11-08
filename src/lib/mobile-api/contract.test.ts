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

describe("inspection contract", () => {
  it("parses what GET /api/inspections sends", async () => {
    const { inspectionList } = await import("./index");
    type Row = import("@/generated/prisma/client").Prisma.JobPermitInspectionGetPayload<{
      include: {
        task: { select: { id: true; title: true; status: true } };
        permit: {
          select: {
            id: true;
            permitType: true;
            permitNumber: true;
            municipality: true;
            job: { select: typeof import("@/lib/labels/select").JOB_LABEL_SELECT };
          };
        };
      };
    }>;
    const row = {
      id: "i1",
      permitId: "p1",
      type: "ROOFING_FINAL",
      scheduledFor: new Date("2026-11-10T14:00:00Z"),
      completedAt: null,
      result: "SCHEDULED",
      inspectorName: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      taskId: null,
      task: null,
      permit: {
        id: "p1",
        permitType: "Reroof",
        permitNumber: "BD26-001",
        municipality: "City of Palm Beach",
        job: {
          id: "j1",
          jobNumber: "JOB-00018",
          title: "Roofing",
          lead: {
            id: "l1",
            kind: "CUSTOMER",
            fullName: "Ana Diaz",
            companyName: null,
            propertyAddress1: "3310 NE 37 St",
            propertyAddress2: null,
            city: "Fort Lauderdale",
            state: "FL",
            zipCode: "33308",
          },
        },
      },
    } as unknown as Row;
    // What the phone receives: the route's JSON.
    const wire = JSON.parse(JSON.stringify([row]));
    const parsed = inspectionList.safeParse(wire);
    expect(parsed.success).toBe(true);
  });

  it("every result the phone records is one the CRM accepts", async () => {
    const { recordInspectionRequest } = await import("./index");
    const { isInspectionResult, isRecordedResult } = await import("@/lib/permits/rules");
    for (const r of recordInspectionRequest.shape.result.options) {
      expect(isInspectionResult(r)).toBe(true);
      if (r !== "CANCELLED") expect(isRecordedResult(r)).toBe(true);
    }
  });
});

describe("field issue contract", () => {
  it("every phone issue type is one the CRM accepts, and a phone id is a valid client id", async () => {
    const { FIELD_ISSUE_TYPES, CLIENT_ID } = await import("./index");
    const route = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../app/api/jobs/[id]/field-issues/route.ts", import.meta.url), "utf8"),
    );
    for (const t of FIELD_ISSUE_TYPES) expect(route).toContain(`"${t}"`);
    expect(CLIENT_ID.test("c" + "0123456789abcdef01234567")).toBe(true);
    expect(CLIENT_ID.test("Bad-Id")).toBe(false);
  });

  it("puts the location on the first line of the description", async () => {
    const { issueDescription } = await import("./index");
    expect(issueDescription("Unit 2 kitchen", "Grout cracked by the sink")).toBe("Location: Unit 2 kitchen\n\nGrout cracked by the sink");
    expect(issueDescription(" ", "Only details")).toBe("Only details");
    expect(issueDescription(undefined, undefined)).toBeUndefined();
  });
});

describe("daily log contract", () => {
  it("every field the phone saves is one the CRM's log route accepts", async () => {
    const { saveDailyLogRequest, LOG_TEXT_FIELDS, LOG_SAFETY_CHECKS } = await import("./index");
    const { dailyLogUpsertSchema } = await import("@/lib/validation/labor");
    const crm = Object.keys(dailyLogUpsertSchema.shape);
    for (const k of Object.keys(saveDailyLogRequest.shape)) expect(crm).toContain(k);
    const body = { ...Object.fromEntries(LOG_TEXT_FIELDS.map((k) => [k, "x"])), ...Object.fromEntries(LOG_SAFETY_CHECKS.map((k) => [k, true])), baseUpdatedAt: new Date().toISOString() };
    expect(saveDailyLogRequest.safeParse(body).success).toBe(true);
    expect(dailyLogUpsertSchema.safeParse(body).success).toBe(true);
  });
});

describe("crew hours contract", () => {
  it("the phone sends exactly the CRM's entry fields, minus the rate", async () => {
    const { LABOR_INPUT_FIELDS, laborEntryInput } = await import("./index");
    const { laborEntryInputSchema } = await import("@/lib/validation/labor");
    const crm = Object.keys(laborEntryInputSchema.shape).filter((k) => k !== "regularRate").sort();
    expect([...LABOR_INPUT_FIELDS].sort()).toEqual(crm);
    expect(Object.keys(laborEntryInput.shape).sort()).toEqual(crm);
  });

  it("a sheet the phone builds passes the CRM's own rules", async () => {
    const { saveLaborSheetRequest } = await import("./index");
    const { laborSheetSchema } = await import("@/lib/validation/labor");
    const sheet = {
      entries: [
        { id: "c0123456789abcdef01234567", personnelId: "p1", trade: null, jobAreaId: null, workArea: null, startMinutes: 420, endMinutes: 1530, breakMinutes: 30, costCodeId: null, phase: null, budgetLineId: null, isAbsent: false, isLate: false, leftEarly: false, absenceReason: null, notes: null },
        { id: "c0123456789abcdef01234568", personnelId: "p2", startMinutes: null, endMinutes: null, breakMinutes: 0, isAbsent: true, isLate: false, leftEarly: false, absenceReason: "Sick" },
      ],
      baseUpdatedAt: new Date().toISOString(),
    };
    expect(saveLaborSheetRequest.safeParse(sheet).success).toBe(true);
    expect(laborSheetSchema.safeParse(sheet).success).toBe(true);
  });
});

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

describe("job files contract", () => {
  it("the phone allows exactly the file types and size the CRM does", async () => {
    const { UPLOAD_MIME, UPLOAD_MAX_BYTES } = await import("./index");
    const { ALLOWED_MIME, MAX_UPLOAD_BYTES } = await import("@/lib/files/limits");
    expect([...UPLOAD_MIME].sort()).toEqual([...ALLOWED_MIME].sort());
    expect(UPLOAD_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
  });

  it("phone document categories are CRM file categories", async () => {
    const { PHONE_DOC_CATEGORIES } = await import("./index");
    const { FileCategory } = await import("@/generated/prisma/client");
    for (const c of PHONE_DOC_CATEGORIES) expect(Object.values(FileCategory)).toContain(c.value);
  });

  it("a gallery item from the CRM's own builder parses", async () => {
    const { jobGallery } = await import("./index");
    const { mergeGallery } = await import("@/lib/photos/gallery");
    const items = mergeGallery("j1", [], [{ id: "f1", fileName: "a.jpg", createdAt: new Date(), takenAt: null, taskId: null, task: null, crewPayment: { crew: "BNW", amount: null, paid: true }, uploadedBy: { firstName: "A", lastName: "B" }, day: "2026-11-08", missing: false } as never]);
    const r = jobGallery.safeParse(JSON.parse(JSON.stringify({ items, canWrite: true })));
    expect(r.success).toBe(true);
    expect(r.success && r.data.items[0].origin).toBe("Crew payment · BNW");
  });
});

describe("owner summary contract", () => {
  it("the CRM's own shapes parse", async () => {
    const { ownerSummary, attentionCounts, attentionList } = await import("./index");
    type Owner = Awaited<ReturnType<typeof import("@/lib/attention/load").loadOwnerSummary>>;
    type List = import("@/lib/attention/rows").AttentionList;
    type Count = import("@/lib/attention/rows").AttentionCount;
    const owner: Owner & { scope: "all" } = { scope: "all", newLeadsToday: 2, uncontacted: 19, pipeline: { leads: 20, value: 179040 }, estimatesOut: { count: 0, total: 0 }, activeJobs: 19, expectedGrossProfit: { total: 0, jobs: 1, jobsWithoutBaseline: 16 } };
    const count: Count = { key: "jobs-delayed", label: "Delayed jobs", tone: "danger", count: 10, href: "/attention/jobs-delayed?scope=all" };
    const list: List = { key: "jobs-delayed", label: "Delayed jobs", description: "d", scope: "all", count: 1, items: [{ id: "j1", primary: "2188 Wind Trace", secondary: "Sarah Smith", code: "JOB-00004", detail: "Blocked task", date: null, href: "/jobs/j1" }] };
    expect(ownerSummary.safeParse(JSON.parse(JSON.stringify(owner))).success).toBe(true);
    expect(attentionCounts.safeParse({ scope: "all", rows: [count] }).success).toBe(true);
    expect(attentionList.safeParse(JSON.parse(JSON.stringify(list))).success).toBe(true);
  });

  it("the phone shows the summary to exactly the roles the CRM serves it to", async () => {
    const { OWNER_ROLES } = await import("./index");
    const { canViewCompanyFinancials } = await import("@/lib/money/access");
    for (const r of ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "CREW_LEAD", "READ_ONLY"])
      expect(OWNER_ROLES.includes(r as never)).toBe(canViewCompanyFinancials(r as never));
  });
});

describe("crew payments and material requests contract", () => {
  it("a labor contract and its requests, as Prisma sends them (Decimal as strings), parse", async () => {
    const { phoneLaborContracts, paymentRequestList, PAYMENT_REQUEST_STATUSES } = await import("./index");
    const { LaborPaymentRequestStatus } = await import("@/generated/prisma/client");
    expect([...PAYMENT_REQUEST_STATUSES].sort()).toEqual(Object.values(LaborPaymentRequestStatus).sort());
    const c = phoneLaborContracts.parse([{ id: "lc1", label: null, crew: { name: "BNW" }, vendor: null, contractAmount: "259870.00", changeOrders: [{ amount: "-500.00" }], payments: [{ amount: "14032.99", paidDate: "2026-10-05T00:00:00.000Z" }], tasks: [] }]);
    expect(c[0].contractAmount).toBe(259870);
    expect(c[0].payments[0].amount).toBe(14032.99);
    const r = paymentRequestList.parse({ requests: [{ id: "r1", amount: "4000.00", note: null, neededBy: "2026-11-10T12:00:00.000Z", status: "REQUESTED", createdAt: "2026-11-08T12:00:00.000Z", requestedBy: { firstName: "A", lastName: "B" }, photos: [] }], defaultAssigneeId: null });
    expect(r.requests[0].amount).toBe(4000);
  });
  it("MATERIAL_REQUEST is a field issue type", async () => {
    const { FieldIssueType } = await import("@/generated/prisma/client");
    expect(Object.values(FieldIssueType)).toContain("MATERIAL_REQUEST");
  });
});

describe("job videos contract", () => {
  it("the phone's video types and limit are the CRM's", async () => {
    const { VIDEO_UPLOAD_MIME, VIDEO_MAX_BYTES } = await import("./index");
    const { VIDEO_MIME, MAX_VIDEO_BYTES } = await import("@/lib/files/limits");
    expect([...VIDEO_UPLOAD_MIME].sort()).toEqual([...VIDEO_MIME].sort());
    expect(VIDEO_MAX_BYTES).toBe(MAX_VIDEO_BYTES);
  });
});

describe("lead notes contract", () => {
  it("an activity row as the CRM sends it parses as a note", async () => {
    const { leadNotes, addLeadNoteRequest } = await import("./index");
    const row = { id: "a1", leadId: "l1", activityType: "NOTE", title: "Note added", description: "Gate code 1234", metadataJson: null, createdByUserId: "u1", createdAt: "2026-11-08T15:00:00.000Z", createdBy: { firstName: "A", lastName: "B" } };
    const r = leadNotes.safeParse([row]);
    expect(r.success).toBe(true);
    expect(r.success && Object.keys(r.data[0]).sort()).toEqual(["createdAt", "createdBy", "description", "id"]);
    expect(addLeadNoteRequest.safeParse({ content: "  " }).success).toBe(false);
  });
});

describe("usage events contract", () => {
  it("every phone event is one the CRM stores", async () => {
    const { PHONE_USAGE_EVENTS } = await import("./index");
    const { USAGE_EVENTS, usageBatchSchema } = await import("@/lib/usage/events");
    for (const e of PHONE_USAGE_EVENTS) expect(USAGE_EVENTS).toContain(e);
    expect(usageBatchSchema.safeParse({ source: "phone", events: PHONE_USAGE_EVENTS.map((event) => ({ event, at: new Date().toISOString() })) }).success).toBe(true);
  });
});

describe("crew guest links contract", () => {
  it("the CRM's submission rows and created links parse", async () => {
    const { crewSubmissions, guestLinkCreated } = await import("./index");
    const row = { id: "s1", purpose: "CREW_PAYMENT", status: "PENDING", createdAt: "2026-11-09T12:00:00.000Z", jobId: "j1", jobNumber: "JOB-00001", street: "2500 North Federal Highway, Boca Raton", from: "Jesús", language: "es", answer: { amount: 1234.5, note: "Marcos" }, photoCount: 1, reviewNote: null, reviewedBy: null, reviewedAt: null, result: null };
    expect(crewSubmissions.safeParse([row]).success).toBe(true);
    expect(guestLinkCreated.safeParse({ id: "l1", url: "https://crm.careyos.com/g/abc", message: "Hola", phone: null, recipientName: null, language: "es", expiresAt: "2026-11-16T00:00:00.000Z" }).success).toBe(true);
  });
});

describe("approvals inbox contract", () => {
  it("the phone's approver list matches who the CRM lets decide", async () => {
    const { APPROVER_ROLES } = await import("./index");
    const { canApproveJobCosts } = await import("@/lib/expenses/permissions");
    const { canApproveLog } = await import("@/lib/labor/permissions");
    const { canManageJobMoney } = await import("@/lib/money/access");
    for (const r of ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "CREW_LEAD", "READ_ONLY"] as const)
      expect(APPROVER_ROLES.includes(r as never)).toBe(canApproveJobCosts(r) || canApproveLog(r) || canManageJobMoney(r));
  });
});

describe("phone expenses contract", () => {
  it("expense types the phone offers are CRM expense types", async () => {
    const { PHONE_EXPENSE_TYPES } = await import("./index");
    const { JobExpenseType } = await import("@/generated/prisma/client");
    for (const t of PHONE_EXPENSE_TYPES) expect(Object.values(JobExpenseType)).toContain(t);
  });
});

describe("phone leads contract", () => {
  it("lead roles are the CRM's lead-writing roles", async () => {
    const { LEAD_ROLES } = await import("./index");
    const { canWriteLeads } = await import("@/lib/access/roles");
    for (const r of ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "CREW_LEAD", "READ_ONLY"] as const)
      expect(LEAD_ROLES.includes(r as never)).toBe(canWriteLeads(r));
  });
  it("contact types are CRM communication types", async () => {
    const { logContactRequest } = await import("./index");
    const { CommunicationType, CommunicationDirection } = await import("@/generated/prisma/client");
    for (const t of logContactRequest.shape.communicationType.options) expect(Object.values(CommunicationType)).toContain(t);
    for (const t of logContactRequest.shape.direction.options) expect(Object.values(CommunicationDirection)).toContain(t);
  });
});

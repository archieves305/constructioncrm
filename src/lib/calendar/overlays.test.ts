import { describe, expect, it } from "vitest";
import { isOverlay, overlayItems, overlayScopes, overlayWhen } from "./overlays";

const now = new Date("2026-09-28T15:00:00.000Z");
const lead = { id: "l1", fullName: "Ana Ruiz", propertyAddress1: "12 Palm Ct", city: "Miami", primaryPhone: null };
const job = { id: "j1", jobNumber: "JOB-00009", title: "Roof", serviceType: "Roofing", lead };
const kase = { id: "c1", caseNumber: "CV-0001", agencyCaseNumber: null, leadId: "l1", lead };

describe("overlayWhen", () => {
  it("a date-picker midnight and a noon pin are all-day on that date; a real time is a one-hour window", () => {
    expect(overlayWhen(new Date("2026-09-29T00:00:00.000Z"))).toMatchObject({ allDay: true, day: "2026-09-29" });
    expect(overlayWhen(new Date("2026-09-29T12:00:00.000Z"))).toMatchObject({ allDay: true, day: "2026-09-29" });
    const w = overlayWhen(new Date("2026-09-29T13:30:00.000Z"));
    expect(w).toMatchObject({ allDay: false, day: "2026-09-29" });
    expect(w.end.toISOString()).toBe("2026-09-29T14:30:00.000Z");
  });
});

describe("overlayItems", () => {
  it("maps every source with a prefixed id, its own icon label, and where it opens", () => {
    const items = overlayItems(
      {
        permitInspections: [{ id: "p1", type: "ROOFING_FINAL", scheduledFor: new Date("2026-09-29T00:00:00.000Z"), result: "SCHEDULED", permit: { id: "pm", permitType: "Roofing", permitNumber: "B-123", job } }],
        hearings: [
          { id: "h1", type: "SPECIAL_MAGISTRATE", status: "SCHEDULED", scheduledAt: new Date("2026-09-30T13:30:00.000Z"), location: "City Hall", case: kase },
          { id: "h2", type: "APPEAL", status: "CANCELLED", scheduledAt: new Date("2026-09-30T13:30:00.000Z"), location: null, case: kase },
        ],
        caseInspections: [{ id: "i1", status: "COMPLETED", scheduledFor: new Date("2026-09-27T12:00:00.000Z"), result: "PASS", case: kase }],
        jobStarts: [{ ...job, targetStartDate: new Date("2026-10-01T12:00:00.000Z") }, { ...job, id: "j2", targetStartDate: null }],
      },
      now,
    );
    expect(items.map((i) => [i.kind, i.id])).toEqual([
      ["permit_inspection", "pi:p1"],
      ["hearing", "hr:h1"],
      ["case_inspection", "ci:i1"],
      ["job_start", "js:j1"],
    ]);
    const [pi, hr, ci, js] = items;
    expect(pi.title).toBe("Roofing Final inspection");
    expect(pi.overlay).toEqual({ label: "Permit inspection", detail: "Roofing · B-123", href: "/jobs/j1?tab=permits", state: "scheduled" });
    expect(pi.job?.id).toBe("j1");
    expect(pi.allDay).toBe(true);
    expect(pi.dayKey).toBe("2026-09-29");
    expect(hr.allDay).toBe(false);
    expect(hr.overlay?.href).toBe("/violations/c1?tab=hearings");
    expect(hr.violationCase?.caseNumber).toBe("CV-0001");
    expect(ci.status).toBe("COMPLETED");
    expect(ci.derived).toBe("completed");
    expect(js.overlay?.href).toBe("/jobs/j1");
    for (const i of items) {
      expect(i.assignedUserId).toBeNull();
      expect(isOverlay(i)).toBe(true);
    }
  });
});

describe("permit dates", () => {
  const permit = { id: "pm", permitType: "Re-roof", permitNumber: "B-9", job, expirationDate: new Date("2026-10-20T00:00:00.000Z"), expectedApprovalDate: new Date("2026-10-02T00:00:00.000Z") };
  const run = (status: string) => overlayItems({ permitInspections: [], hearings: [], caseInspections: [], jobStarts: [], permitDates: [{ ...permit, status }] }, now).map((i) => [i.id, i.title, i.dayKey]);

  it("a permit in review shows its expected approval and its expiry; an issued one only its expiry", () => {
    expect(run("APPLIED")).toEqual([
      ["px:pm", "Permit expires", "2026-10-20"],
      ["pa:pm", "Permit approval expected", "2026-10-02"],
    ]);
    expect(run("ISSUED")).toEqual([["px:pm", "Permit expires", "2026-10-20"]]);
  });

  it("a closed or denied permit shows neither", () => {
    expect(run("FINAL")).toEqual([]);
    expect(run("DENIED")).toEqual([]);
  });

  it("opens the job's Permits tab and is read-only like every overlay", () => {
    const [x] = overlayItems({ permitInspections: [], hearings: [], caseInspections: [], jobStarts: [], permitDates: [{ ...permit, status: "ISSUED" }] }, now);
    expect(x.kind).toBe("permit_date");
    expect(x.overlay).toEqual({ label: "Permit expiry", detail: "Re-roof · B-9", href: "/jobs/j1?tab=permits", state: "scheduled" });
    expect(x.allDay).toBe(true);
    expect(isOverlay(x)).toBe(true);
  });
});

describe("overlayScopes", () => {
  it("own-only roles get their visibility scope; My calendar is involvement; everyone is everything", () => {
    const rep = { id: "rep", role: "SALES_REP" as const };
    expect(overlayScopes({ kind: "all" }, rep, { jobIds: ["j1"], violationCaseIds: ["c1"] })).toEqual({ jobs: { id: { in: ["j1"] } }, cases: { id: { in: ["c1"] } } });
    const admin = { id: "adm", role: "ADMIN" as const };
    const me = overlayScopes({ kind: "me" }, admin, undefined);
    expect(JSON.stringify(me.jobs)).toContain('"projectManagerId":"adm"');
    expect(me.cases).toEqual({ OR: [{ caseManagerId: "adm" }, { workflow: { team: { some: { userId: "adm" } } } }] });
    expect(overlayScopes({ kind: "all" }, admin, undefined)).toEqual({ jobs: {}, cases: {} });
  });
});

describe("vendor document overlays", () => {
  it("puts a certificate's expiry on its day and opens the vendor", () => {
    const [item] = overlayItems(
      { permitInspections: [], hearings: [], caseInspections: [], jobStarts: [], vendorDocs: [{ id: "d1", label: "General liability certificate", expiresAt: new Date("2026-11-04T12:00:00.000Z"), vendor: { id: "v1", name: "Rocket HVAC" } }] },
      new Date("2026-10-05T15:00:00.000Z"),
    );
    expect(item).toMatchObject({ id: "vd:d1", kind: "vendor_doc", title: "General liability certificate expires — Rocket HVAC", dayKey: "2026-11-04", allDay: true });
    expect(item.overlay).toMatchObject({ href: "/vendors/v1", label: "Vendor document" });
  });
});

describe("crew install overlays", () => {
  it("puts a crew's install on its day and opens the job's Crews tab", () => {
    const items = overlayItems(
      {
        permitInspections: [],
        hearings: [],
        caseInspections: [],
        jobStarts: [],
        crewInstalls: [
          { id: "a1", installDate: new Date("2026-10-14T12:00:00.000Z"), crew: { name: "Apex Roofing", trades: ["Roofing"] }, job },
          { id: "a2", installDate: null, crew: { name: "No Date Crew", trades: [] }, job },
        ],
      },
      new Date("2026-10-05T15:00:00.000Z"),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "cw:a1", kind: "crew_install", title: "Install — Apex Roofing", dayKey: "2026-10-14", allDay: true });
    expect(items[0].job?.id).toBe("j1");
    expect(items[0].overlay).toMatchObject({ href: "/jobs/j1?tab=field&sub=crews", label: "Crew install", detail: "Roofing" });
    expect(isOverlay(items[0])).toBe(true);
  });
});

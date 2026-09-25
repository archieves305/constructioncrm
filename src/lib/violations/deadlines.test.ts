import { describe, expect, it } from "vitest";
import { collectDeadlines, groupByRecipient, planReminders, reminderKey, type CaseForDeadlines, type DeadlineRef } from "./deadlines";

const now = new Date("2026-10-01T13:00:00Z");
const d = (s: string) => new Date(`${s}T17:00:00Z`);

function caseRow(over: Partial<CaseForDeadlines> = {}): CaseForDeadlines {
  return {
    id: "c1", caseNumber: "CV-00001", leadId: "l1", status: "ACTIVE", caseManagerId: "cm",
    currentDeadline: d("2026-10-20"), appealDeadline: null, agencyConfirmedAt: null, fineAccrualStartDate: null, fineAccrualStoppedAt: null,
    hearings: [], inspections: [], job: null, ...over,
  };
}

describe("collectDeadlines", () => {
  it("lists the compliance deadline to the case manager, keyed by its date", () => {
    const refs = collectDeadlines(caseRow(), now);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "COMPLIANCE", entityId: "deadline@2026-10-20", recipientUserId: "cm", overdueDaily: true });
  });
  it("drops the compliance deadline once the agency has confirmed, and everything on a closed case", () => {
    expect(collectDeadlines(caseRow({ agencyConfirmedAt: now }), now)).toEqual([]);
    expect(collectDeadlines(caseRow({ status: "CLOSED", hearings: [{ id: "h", scheduledAt: d("2026-10-05"), status: "SCHEDULED", type: "APPEAL", attendeeUserId: "u" }] }), now)).toEqual([]);
  });
  it("hearings and inspections go to their attendee, else the case manager; past ones are silent", () => {
    const refs = collectDeadlines(
      caseRow({
        hearings: [
          { id: "h1", scheduledAt: d("2026-10-05"), status: "SCHEDULED", type: "SPECIAL_MAGISTRATE", attendeeUserId: "att" },
          { id: "h2", scheduledAt: d("2026-09-20"), status: "SCHEDULED", type: "APPEAL", attendeeUserId: "att" },
          { id: "h3", scheduledAt: d("2026-10-09"), status: "HELD", type: "APPEAL", attendeeUserId: "att" },
        ],
        inspections: [{ id: "i1", scheduledFor: d("2026-10-03"), status: "SCHEDULED", kind: "REINSPECTION", attendeeUserId: null }],
      }),
      now,
    );
    expect(refs.map((r) => [r.kind, r.recipientUserId, r.entityId])).toEqual([
      ["COMPLIANCE", "cm", "deadline@2026-10-20"],
      ["HEARING", "att", "h1@2026-10-05"],
      ["AGENCY_INSPECTION", "cm", "i1@2026-10-03"],
    ]);
    expect(refs[1]!.label).toBe("Special magistrate hearing");
  });
  it("appeal and accrual-start only while future; permit expiry from the linked job to its PM", () => {
    const refs = collectDeadlines(
      caseRow({
        appealDeadline: d("2026-09-30"),
        fineAccrualStartDate: d("2026-10-11"),
        job: { projectManagerId: "pm", permits: [{ id: "p1", permitNumber: "B-77", expirationDate: d("2026-12-01"), status: "ISSUED" }, { id: "p2", permitNumber: null, expirationDate: d("2026-12-01"), status: "FINAL" }] },
      }),
      now,
    );
    expect(refs.map((r) => r.kind)).toEqual(["COMPLIANCE", "FINE_ACCRUAL_START", "PERMIT_EXPIRATION"]);
    expect(refs[2]).toMatchObject({ recipientUserId: "pm", label: "Permit B-77 expires", tab: "permits" });
  });
});

function ref(over: Partial<DeadlineRef> = {}): DeadlineRef {
  return { kind: "COMPLIANCE", caseId: "c1", caseNumber: "CV-00001", leadId: "l1", entityId: "deadline@2026-10-20", label: "Compliance deadline", at: d("2026-10-20"), overdueDaily: true, recipientUserId: "cm", tab: null, ...over };
}

describe("planReminders", () => {
  it("sends the nearest crossed offset once, then nothing until the next threshold", () => {
    const r = ref(); // 19 days out
    const first = planReminders([r], now, new Set());
    expect(first.map((p) => p.offsetKey)).toEqual(["d30"]);
    const sent = new Set([reminderKey({ ...r, offsetKey: "d30" })]);
    expect(planReminders([r], now, sent)).toEqual([]);
    // 12 days out: the 14-day threshold has been crossed
    expect(planReminders([r], new Date("2026-10-08T13:00:00Z"), sent).map((p) => p.offsetKey)).toEqual(["d14"]);
  });
  it("catches up with ONE mail after a gap: the most recent threshold, not every missed one", () => {
    const r = ref();
    const planned = planReminders([r], new Date("2026-10-18T13:00:00Z"), new Set()); // 2 days out, nothing ever sent
    expect(planned.map((p) => p.offsetKey)).toEqual(["d3"]);
  });
  it("due today is d0; overdue compliance is one per calendar day; other kinds go quiet when past", () => {
    const r = ref();
    expect(planReminders([r], new Date("2026-10-20T13:00:00Z"), new Set([reminderKey({ ...r, offsetKey: "d1" })])).map((p) => p.offsetKey)).toEqual(["d0"]);
    const late = new Date("2026-10-23T13:00:00Z");
    expect(planReminders([r], late, new Set()).map((p) => [p.offsetKey, p.daysRemaining])).toEqual([["od:2026-10-23", -3]]);
    expect(planReminders([r], late, new Set([reminderKey({ ...r, offsetKey: "od:2026-10-23" })]))).toEqual([]);
    expect(planReminders([ref({ kind: "HEARING", overdueDaily: false })], late, new Set())).toEqual([]);
  });
  it("skips refs with nobody to tell, and groups the rest by recipient", () => {
    const planned = planReminders([ref({ recipientUserId: null }), ref({ kind: "HEARING", entityId: "h@2026-10-20", recipientUserId: "att" }), ref({ caseId: "c2", entityId: "deadline@2026-10-20" })], now, new Set());
    const grouped = groupByRecipient(planned);
    expect([...grouped.keys()]).toEqual(["att", "cm"]);
    expect(grouped.get("cm")).toHaveLength(1);
  });
});

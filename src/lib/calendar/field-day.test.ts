import { describe, expect, it } from "vitest";
import { contactOf, fieldActions, fieldDayLine, greeting, splitFieldDay } from "./field-day";
import { makeItem } from "./test-fixtures";

const lead = { id: "l1", fullName: "Ana Ruiz", propertyAddress1: "2500 N Federal Hwy", city: "Fort Lauderdale", state: "FL", zipCode: "33305", primaryPhone: "(954) 555-0100" };
const job = { id: "j1", jobNumber: "JOB-00009", title: "Roof", lead };

describe("fieldActions", () => {
  it("an open task on a job with an address and phone gets every action", () => {
    const a = fieldActions(makeItem({ job, checklist: { done: 2, total: 5 } }), "2026-09-29");
    expect(a.start).toBe(true);
    expect(a.done).toBe(true);
    expect(a.directions?.propertyAddress1).toBe("2500 N Federal Hwy");
    expect(a.call).toBe("(954) 555-0100");
    expect(a.photoHref).toBe("/field/jobs/j1/daily/2026-09-29");
    expect(a.checklist).toEqual({ done: 2, total: 5 });
  });
  it("started tasks lose Start; closed tasks lose Start and Done", () => {
    expect(fieldActions(makeItem({ status: "IN_PROGRESS" }), "2026-09-29").start).toBe(false);
    const done = fieldActions(makeItem({ status: "COMPLETED" }), "2026-09-29");
    expect(done.start).toBe(false);
    expect(done.done).toBe(false);
  });
  it("no address, a placeholder address or a short number hides Directions / Call; no job hides Photo", () => {
    const a = fieldActions(makeItem({ lead: { ...lead, propertyAddress1: "TBD", primaryPhone: "555" } }), "2026-09-29");
    expect(a.directions).toBeNull();
    expect(a.call).toBeNull();
    expect(a.photoHref).toBeNull();
    expect(a.checklist).toBeNull();
  });
  it("prefers the job's customer over the task's own lead", () => {
    const item = makeItem({ job, lead: { ...lead, id: "l2", primaryPhone: "(305) 555-0199" } });
    expect(contactOf(item)?.id).toBe("l1");
  });
});

describe("splitFieldDay / fieldDayLine", () => {
  it("separates open from finished, keeps order, counts a span once", () => {
    const a = makeItem({ id: "a" });
    const b = makeItem({ id: "b", status: "COMPLETED" });
    const c = makeItem({ id: "c", status: "IN_PROGRESS" });
    const ev = makeItem({ id: "e", kind: "permit_inspection", overlay: { label: "Permit inspection", detail: null, href: "/jobs/j1?tab=permits", state: "scheduled" } });
    const d = splitFieldDay([ev, a, b, c, a]);
    expect(d.remaining.map((i) => i.id)).toEqual(["a", "c"]);
    expect(d.done.map((i) => i.id)).toEqual(["b"]);
    expect(d.events.map((i) => i.id)).toEqual(["e"]);
    expect(d.total).toBe(3);
    expect(fieldDayLine(d)).toBe("3 tasks · 2 remaining");
    expect(fieldDayLine(splitFieldDay([b]))).toBe("1 task · all done");
    expect(fieldDayLine(splitFieldDay([]))).toBe("Nothing scheduled");
  });
});

describe("greeting", () => {
  it("follows the clock", () => {
    expect(greeting(7, "Frank")).toBe("Good morning, Frank");
    expect(greeting(13, "Frank")).toBe("Good afternoon, Frank");
    expect(greeting(19, "")).toBe("Good evening");
  });
});

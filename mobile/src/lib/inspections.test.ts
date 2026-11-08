// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { InspectionDto } from "@crm/mobile-api";
import { splitInspections } from "./inspections";

const make = (over: Partial<InspectionDto>): InspectionDto =>
  ({
    id: "i",
    type: "FINAL",
    result: "SCHEDULED",
    scheduledFor: null,
    completedAt: null,
    inspectorName: null,
    notes: null,
    task: null,
    permit: { id: "p", permitType: null, permitNumber: null, municipality: null, job: { id: "j", jobNumber: "JOB-1", title: "t", lead: null } },
    ...over,
  }) as InspectionDto;

test("booked earliest first with undated last; results newest first", () => {
  const { booked, done } = splitInspections([
    make({ id: "b-undated" }),
    make({ id: "b-late", scheduledFor: "2026-11-20T14:00:00Z" }),
    make({ id: "b-soon", scheduledFor: "2026-11-10T14:00:00Z" }),
    make({ id: "d-old", result: "PASS", completedAt: "2026-10-01T14:00:00Z" }),
    make({ id: "d-new", result: "FAIL", completedAt: "2026-11-01T14:00:00Z" }),
  ]);
  assert.deepEqual(booked.map((i) => i.id), ["b-soon", "b-late", "b-undated"]);
  assert.deepEqual(done.map((i) => i.id), ["d-new", "d-old"]);
});

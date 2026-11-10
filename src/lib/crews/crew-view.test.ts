import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
import { groupWeek, orderCards } from "./crew-view";

const card = (over: Partial<Parameters<typeof orderCards>[0][number]>) => ({
  jobId: "j",
  street: "A St",
  city: null,
  title: "t",
  startMinutes: null,
  installToday: false,
  pm: null,
  tasks: [],
  logStatus: "NONE" as const,
  openIssues: 0,
  ...over,
});
const task = (dueAt: string | null) => ({ id: Math.random().toString(), title: "x", status: "PENDING", priority: "MEDIUM", dueAt });

describe("crew day", () => {
  it("puts an install day first, then the job with work due today", () => {
    const cards = [
      card({ jobId: "quiet", street: "Z St" }),
      card({ jobId: "due", tasks: [task("2026-11-09T12:00:00.000Z")] }),
      card({ jobId: "install", installToday: true }),
      card({ jobId: "later", tasks: [task("2026-11-20T12:00:00.000Z"), task(null)] }),
    ];
    expect(orderCards(cards, "2026-11-09").map((c) => c.jobId)).toEqual(["install", "due", "later", "quiet"]);
  });
});

describe("crew week", () => {
  it("lays out seven days from the start, earliest start first, unset last", () => {
    const item = (day: string, id: string, startMinutes: number | null) => ({ day, crewAssignmentId: id, jobId: "j", street: "S", crewName: null, startMinutes, confirmation: null });
    const days = groupWeek([item("2026-11-10", "b", null), item("2026-11-10", "a", 450), item("2026-11-16", "z", 420), item("2026-11-17", "out", 400)], "2026-11-10");
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe("2026-11-10");
    expect(days[0].items.map((i) => i.crewAssignmentId)).toEqual(["a", "b"]);
    expect(days[6].items.map((i) => i.crewAssignmentId)).toEqual(["z"]);
    expect(days.flatMap((d) => d.items).some((i) => i.crewAssignmentId === "out")).toBe(false);
    expect("day" in days[0].items[0]).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { filterGallery, groupByDay, mergeGallery, type FilePhotoRow, type LogPhotoRow } from "./gallery";

const by = { firstName: "Frank", lastName: "Picado" };
const log = (over: Partial<LogPhotoRow>): LogPhotoRow => ({
  id: "p1", photoDate: "2026-09-03", createdAt: "2026-09-03T15:00:00.000Z", category: "PROGRESS", caption: null, areaText: null,
  fileName: "a.jpg", dailyLogId: "dl1", jobArea: null, takenBy: by, missing: false, ...over,
});
const file = (over: Partial<FilePhotoRow>): FilePhotoRow => ({
  id: "f1", fileName: "b.jpg", createdAt: "2026-09-04T18:00:00.000Z", day: "2026-09-04", taskId: "t1", task: { id: "t1", title: "Final walkthrough" },
  uploadedBy: by, missing: false, ...over,
});

describe("mergeGallery", () => {
  it("puts daily-log photos and task photos in one list, newest day first", () => {
    const items = mergeGallery("j1", [log({}), log({ id: "p2", photoDate: "2026-09-05" })], [file({})]);
    expect(items.map((i) => i.key)).toEqual(["log:p2", "file:f1", "log:p1"]);
  });

  it("says where each photo came from and where to see it", () => {
    const [f, l] = mergeGallery("j1", [log({ jobArea: { name: "Kitchen" } })], [file({})]);
    expect(f).toMatchObject({ source: "file", origin: "Task · Final walkthrough", href: "/tasks?task=t1", url: "/api/files/f1", category: null });
    expect(l).toMatchObject({ source: "log", origin: "Daily log · Sep 3", href: "/jobs/j1/daily-logs/2026-09-03", url: "/api/photos/p1/raw", area: "Kitchen" });
  });

  it("an image uploaded on the Files tab is 'Uploaded' and opens the Files tab", () => {
    const [u] = mergeGallery("j1", [], [file({ task: null, taskId: null })]);
    expect(u).toMatchObject({ origin: "Uploaded", href: "/jobs/j1?tab=files" });
  });

  it("orders within a day by time, newest first", () => {
    const items = mergeGallery("j1", [log({ id: "early", createdAt: "2026-09-03T09:00:00.000Z" }), log({ id: "late", createdAt: "2026-09-03T17:00:00.000Z" })], []);
    expect(items.map((i) => i.id)).toEqual(["late", "early"]);
  });

  it("keeps a photo whose image is missing", () => {
    expect(mergeGallery("j1", [log({ missing: true })], [])[0].missing).toBe(true);
  });
});

describe("filterGallery", () => {
  const items = mergeGallery("j1", [log({}), log({ id: "p2", category: "DAMAGE", missing: true })], [file({})]);
  it("filters by source", () => {
    expect(filterGallery(items, { source: "file" }).map((i) => i.key)).toEqual(["file:f1"]);
    expect(filterGallery(items, { source: "log" })).toHaveLength(2);
  });
  it("a daily-log category leaves out files, which have none", () => {
    expect(filterGallery(items, { category: "DAMAGE" }).map((i) => i.key)).toEqual(["log:p2"]);
  });
  it("filters to the missing", () => {
    expect(filterGallery(items, { missingOnly: true }).map((i) => i.key)).toEqual(["log:p2"]);
    expect(filterGallery(items, {})).toHaveLength(3);
  });
});

describe("mergeGallery, oldest first (Project photos)", () => {
  it("runs from the first day to the last, and within a day by time", () => {
    const items = mergeGallery(
      "j1",
      [log({ id: "a", photoDate: "2026-09-03", createdAt: "2026-09-03T15:00:00.000Z" }), log({ id: "b", photoDate: "2026-09-03", createdAt: "2026-09-03T12:00:00.000Z" })],
      [file({ id: "c", day: "2026-09-01" })],
      "oldest",
    );
    expect(items.map((i) => i.key)).toEqual(["file:c", "log:b", "log:a"]);
  });

  it("a photo with a capture time is placed by it, not by its upload", () => {
    const items = mergeGallery(
      "j1",
      [log({ id: "a", photoDate: "2026-09-03", createdAt: "2026-09-03T15:00:00.000Z" })],
      [file({ id: "c", day: "2026-09-03", createdAt: "2026-09-03T20:00:00.000Z", takenAt: "2026-09-03T13:00:00.000Z" })],
      "oldest",
    );
    expect(items.map((i) => i.key)).toEqual(["file:c", "log:a"]);
    expect(items[0].at).toBe("2026-09-03T13:00:00.000Z");
  });

  it("groups by day in the order given", () => {
    const items = mergeGallery("j1", [log({ id: "a", photoDate: "2026-09-03" })], [file({ id: "c", day: "2026-09-01" }), file({ id: "d", day: "2026-09-01" })], "oldest");
    expect(groupByDay(items).map((g) => [g.day, g.items.length])).toEqual([["2026-09-01", 2], ["2026-09-03", 1]]);
  });
});

describe("completion photos on crew payments", () => {
  it("names the crew and amount, and opens Field → Labor", () => {
    const [paid] = mergeGallery("j1", [], [file({ task: null, taskId: null, crewPayment: { crew: "BNW", amount: 13199.15, paid: true } })]);
    expect(paid.origin).toBe("Crew payment · BNW · $13,199.15");
    expect(paid.href).toBe("/jobs/j1?tab=field&sub=labor");
    const [asked] = mergeGallery("j1", [], [file({ task: null, taskId: null, crewPayment: { crew: "BNW", amount: 5000, paid: false } })]);
    expect(asked.origin).toBe("Payment request · BNW · $5,000");
  });
});

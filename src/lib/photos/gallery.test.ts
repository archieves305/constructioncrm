import { describe, expect, it } from "vitest";
import { filterGallery, mergeGallery, type FilePhotoRow, type LogPhotoRow } from "./gallery";

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

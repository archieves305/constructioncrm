import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, storage } = vi.hoisted(() => ({
  db: { task: { findUnique: vi.fn() }, file: { findMany: vi.fn(), findFirst: vi.fn() } },
  storage: { fileExists: vi.fn(), readFile: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/files/storage", () => storage);
vi.mock("@/lib/tasks/create", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: vi.fn() }));

const { taskFilesForWork, taskFileForWork, WORK_FILE_LIMITS } = await import("./files");

const file = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  fileName: "after.jpg",
  fileType: "image/jpeg",
  fileSize: 200_000,
  storageKey: "2026-11/after.jpg",
  takenAt: new Date("2026-11-10T15:00:00Z"),
  createdAt: new Date("2026-11-10T15:01:00Z"),
  ...over,
});

beforeEach(() => {
  db.task.findUnique.mockReset().mockResolvedValue({ id: "t1", sourceKey: "work:maint:1:x" });
  db.file.findMany.mockReset();
  db.file.findFirst.mockReset();
  storage.fileExists.mockReset().mockResolvedValue(true);
  storage.readFile.mockReset().mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe("task files for Work", () => {
  it("answers 404 for a task Work did not create", async () => {
    db.task.findUnique.mockResolvedValue({ id: "t1", sourceKey: "invoice:SENT:x" });
    await expect(taskFilesForWork("t1")).rejects.toMatchObject({ status: 404 });
    await expect(taskFileForWork("t1", "f1")).rejects.toMatchObject({ status: 404 });
    db.task.findUnique.mockResolvedValue(null);
    await expect(taskFilesForWork("t1")).rejects.toMatchObject({ status: 404 });
  });

  it("lists photos and PDFs on the task, leaving out other types, oversized and missing files", async () => {
    db.file.findMany.mockResolvedValue([
      file(),
      file({ id: "f2", fileName: "notes.docx", fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      file({ id: "f3", fileSize: WORK_FILE_LIMITS.bytes + 1 }),
      file({ id: "f4", storageKey: "gone.jpg" }),
      file({ id: "f5", fileName: "invoice.pdf", fileType: "application/pdf", takenAt: null }),
    ]);
    storage.fileExists.mockImplementation(async (k: string) => k !== "gone.jpg");
    const out = await taskFilesForWork("t1");
    expect(out.map((f) => f.fileId)).toEqual(["f1", "f5"]);
    expect(out[0]).toMatchObject({ fileName: "after.jpg", takenAt: "2026-11-10T15:00:00.000Z" });
    expect(db.file.findMany.mock.calls[0][0].where).toEqual({ taskId: "t1" });
  });

  it("serves a file only when it is on that task", async () => {
    db.file.findFirst.mockResolvedValue(null);
    await expect(taskFileForWork("t1", "other")).rejects.toMatchObject({ status: 404 });
    expect(db.file.findFirst.mock.calls[0][0].where).toEqual({ id: "other", taskId: "t1" });
    db.file.findFirst.mockResolvedValue(file());
    const f = await taskFileForWork("t1", "f1");
    expect(f).toMatchObject({ fileType: "image/jpeg", fileName: "after.jpg" });
    expect([...f.bytes]).toEqual([1, 2, 3]);
  });
});

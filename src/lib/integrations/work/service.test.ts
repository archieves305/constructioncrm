import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const { db, createTask, updateTask } = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    job: { findFirst: vi.fn() },
    task: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
  },
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/tasks/create", () => ({ createTask: (...a: unknown[]) => createTask(...a) }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: (...a: unknown[]) => updateTask(...a) }));

const { createFromWork, cancelFromWork, tasksByIds, WorkApiError } = await import("./service");
const { safeEqual } = await import("./auth");

const row = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Order shingles",
  status: "PENDING",
  dueAt: new Date("2026-11-03T12:00:00Z"),
  updatedAt: new Date("2026-10-30T15:00:00Z"),
  completedAt: null,
  sourceKey: "work:crm:item1:1",
  jobId: "j1",
  job: { id: "j1", jobNumber: "JOB-00042", title: null, serviceType: null, lead: { propertyAddress1: "12 Oak St", city: "Miami" } },
  assignedTo: { email: "jose@knu.test", firstName: "Jose", lastName: "Martinez" },
  ...over,
});

const body = {
  idempotencyKey: "crm:item1:1",
  actingEmail: "Richard@RCareyLaw.com",
  jobId: "j1",
  title: "Order shingles",
  assigneeEmail: "jose@knu.test",
  dueDate: "2026-11-03",
  priority: "HIGH",
};

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
  createTask.mockReset().mockResolvedValue({ id: "t1" });
  updateTask.mockReset().mockResolvedValue({});
  db.user.findFirst.mockImplementation(async ({ where }: { where: { email: string } }) =>
    where.email === "richard@rcareylaw.com" ? { id: "u-richard", role: { name: "ADMIN" } } : where.email === "jose@knu.test" ? { id: "u-jose" } : null,
  );
  db.user.findMany.mockResolvedValue([]);
  db.job.findFirst.mockResolvedValue({ id: "j1" });
  db.task.findFirst.mockResolvedValue(null);
  db.task.findUniqueOrThrow.mockResolvedValue(row());
});

describe("createFromWork", () => {
  it("creates the task as the acting CRM user, on the job, keyed for idempotency", async () => {
    const { task, created } = await createFromWork(body);
    expect(created).toBe(true);
    const [input, opts] = createTask.mock.calls[0];
    expect(input).toMatchObject({
      title: "Order shingles",
      createdByUserId: "u-richard",
      assignedUserId: "u-jose",
      jobId: "j1",
      priority: "HIGH",
      source: "work",
      sourceKey: "work:crm:item1:1",
    });
    expect(input.dueAt.toISOString()).toBe("2026-11-03T12:00:00.000Z");
    expect(opts).toEqual({ actorUserId: "u-richard" });
    expect(task).toMatchObject({ taskId: "t1", status: "PENDING", assigneeEmail: "jose@knu.test", dueDate: "2026-11-03", createdFromWork: true });
    expect(task.url).toMatch(/\/tasks\?task=t1$/);
  });

  it("never replays a task to a sender who can't see its job", async () => {
    db.task.findFirst.mockResolvedValue(row());
    db.job.findFirst.mockResolvedValue(null);
    await expect(createFromWork(body)).rejects.toMatchObject({ status: 404 });
  });

  it("returns the existing task on a retry and creates nothing", async () => {
    db.task.findFirst.mockResolvedValue(row());
    const { created } = await createFromWork(body);
    expect(created).toBe(false);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("resolves a concurrent double-send through the unique index", async () => {
    createTask.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    db.task.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    const { task, created } = await createFromWork(body);
    expect(created).toBe(false);
    expect(task.taskId).toBe("t1");
  });

  it("refuses a sender who has no active CRM account", async () => {
    await expect(createFromWork({ ...body, actingEmail: "stranger@x.test" })).rejects.toMatchObject({ status: 403 });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("refuses a job the sender can't see in the CRM", async () => {
    db.job.findFirst.mockResolvedValue(null);
    await expect(createFromWork(body)).rejects.toMatchObject({ status: 404 });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("refuses an assignee with no CRM account instead of leaving it unassigned", async () => {
    await expect(createFromWork({ ...body, assigneeEmail: "ghost@knu.test" })).rejects.toMatchObject({ status: 400 });
  });

  it("validates the body", async () => {
    await expect(createFromWork({ ...body, dueDate: "11/03/2026" })).rejects.toBeInstanceOf(WorkApiError);
    await expect(createFromWork({ ...body, idempotencyKey: "x" })).rejects.toMatchObject({ status: 400 });
  });

  it("starts the task In progress when asked", async () => {
    await createFromWork({ ...body, status: "IN_PROGRESS" });
    expect(updateTask).toHaveBeenCalledWith({ id: "t1", input: { status: "IN_PROGRESS" }, actorUserId: "u-richard" });
  });
});

describe("reads and cancel", () => {
  it("only reports tasks Work created", async () => {
    db.task.findMany.mockResolvedValue([row()]);
    await tasksByIds(["t1", "t1", "t2"]);
    expect(db.task.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["t1", "t2"] }, sourceKey: { startsWith: "work:" } });
  });

  it("cancels only a Work-created task", async () => {
    db.task.findUnique.mockResolvedValue(row({ sourceKey: "invoice:SENT:x" }));
    await expect(cancelFromWork("t1", "richard@rcareylaw.com")).rejects.toMatchObject({ status: 404 });
    db.task.findUnique.mockResolvedValue(row());
    db.task.findUniqueOrThrow.mockResolvedValue(row({ status: "CANCELLED" }));
    const t = await cancelFromWork("t1", "richard@rcareylaw.com");
    expect(updateTask).toHaveBeenCalledWith({ id: "t1", input: { status: "CANCELLED" }, actorUserId: "u-richard" });
    expect(t.status).toBe("CANCELLED");
  });

  it("leaves an already-closed task alone", async () => {
    db.task.findUnique.mockResolvedValue(row({ status: "COMPLETED" }));
    await cancelFromWork("t1", "richard@rcareylaw.com");
    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe("auth", () => {
  it("compares keys in constant time without throwing on length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMessageMock, sendEmailMock, isEmailConfiguredMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  sendEmailMock: vi.fn(),
  isEmailConfiguredMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    followUpExecution: { findMany: vi.fn(), update: vi.fn() },
    notificationEvent: { create: vi.fn() },
    task: { create: vi.fn() },
  },
}));

vi.mock("@/lib/services/notifications/twilio-provider", () => ({
  TwilioSmsProvider: class {
    sendMessage = sendMessageMock;
  },
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: sendEmailMock,
  isEmailConfigured: isEmailConfiguredMock,
}));

vi.mock("@/lib/templates/render", () => ({
  renderTemplate: (tpl: string, ctx: Record<string, unknown>) =>
    tpl.replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => {
      const value = path.split(".").reduce<unknown>(
        (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
        ctx,
      );
      return value == null ? "" : String(value);
    }),
}));

vi.mock("@/lib/env", () => ({
  env: { TWILIO_FROM_NUMBER: "+15555555555" },
}));

import { processPendingFollowUps } from "./processor";
import { prisma } from "@/lib/db/prisma";

type Exec = {
  id: string;
  leadId: string;
  ruleId: string;
  rule: {
    isActive: boolean;
    messageTemplate: { name: string; channel: string; templateBody: string } | null;
    taskTemplateJson:
      | { title?: string; description?: string; dueInDays?: number; priority?: string }
      | null;
  };
  lead: {
    firstName: string;
    lastName: string;
    fullName: string;
    primaryPhone: string;
    email: string | null;
    city: string | null;
    propertyAddress1: string | null;
    companyName: string | null;
    assignedUserId: string | null;
    createdByUserId: string;
    assignedUser: { firstName: string; lastName: string; email: string } | null;
  };
};

function execFixture(overrides: Partial<Exec> = {}): Exec {
  return {
    id: "exec1",
    leadId: "lead1",
    ruleId: "rule1",
    rule: {
      isActive: true,
      messageTemplate: { name: "Welcome", channel: "SMS", templateBody: "Hi" },
      taskTemplateJson: null,
    },
    lead: {
      firstName: "Ada",
      lastName: "Lovelace",
      fullName: "Ada Lovelace",
      primaryPhone: "+15551234567",
      email: "ada@example.com",
      city: "Tampa",
      propertyAddress1: "123 Main",
      companyName: null,
      assignedUserId: "user1",
      createdByUserId: "user-creator",
      assignedUser: { firstName: "Sam", lastName: "Rep", email: "sam@x.com" },
    },
    ...overrides,
  };
}

describe("processPendingFollowUps", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    sendEmailMock.mockReset();
    isEmailConfiguredMock.mockReset().mockReturnValue(true);
    vi.mocked(prisma.followUpExecution.findMany).mockReset();
    vi.mocked(prisma.followUpExecution.update).mockReset().mockResolvedValue({} as never);
    vi.mocked(prisma.notificationEvent.create).mockReset().mockResolvedValue({} as never);
    vi.mocked(prisma.task.create).mockReset().mockResolvedValue({} as never);
  });

  it("returns zeros when there is nothing to process", async () => {
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([] as never);
    const result = await processPendingFollowUps();
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0, cancelled: 0 });
  });

  it("cancels executions whose rule has been deactivated", async () => {
    const exec = execFixture({ rule: { isActive: false, messageTemplate: null, taskTemplateJson: null } });
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([exec] as never);

    const result = await processPendingFollowUps();

    expect(result.cancelled).toBe(1);
    expect(result.sent).toBe(0);
    expect(vi.mocked(prisma.followUpExecution.update)).toHaveBeenCalledWith({
      where: { id: "exec1" },
      data: { status: "CANCELLED", executedAt: expect.any(Date) },
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("sends an SMS when the rule has an SMS template", async () => {
    const exec = execFixture();
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([exec] as never);

    const result = await processPendingFollowUps();

    expect(result.sent).toBe(1);
    expect(sendMessageMock).toHaveBeenCalledWith({
      to: "+15551234567",
      from: "+15555555555",
      body: "Hi",
    });
    expect(vi.mocked(prisma.notificationEvent.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channel: "SMS", provider: "twilio", status: "SENT" }),
      }),
    );
  });

  it("sends an email when the rule has an EMAIL template", async () => {
    const exec = execFixture({
      rule: {
        isActive: true,
        messageTemplate: { name: "Subj", channel: "EMAIL", templateBody: "Body" },
        taskTemplateJson: null,
      },
    });
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([exec] as never);

    const result = await processPendingFollowUps();

    expect(result.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ada@example.com", subject: "Subj", text: "Body" }),
    );
    expect(vi.mocked(prisma.notificationEvent.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channel: "EMAIL", provider: "resend" }),
      }),
    );
  });

  it("creates an in-app notification for an IN_APP template without calling external providers", async () => {
    const exec = execFixture({
      rule: {
        isActive: true,
        messageTemplate: { name: "n", channel: "IN_APP", templateBody: "msg" },
        taskTemplateJson: null,
      },
    });
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([exec] as never);

    const result = await processPendingFollowUps();

    expect(result.sent).toBe(1);
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.notificationEvent.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channel: "IN_APP", provider: "internal" }),
      }),
    );
  });

  it("creates a task when the rule has a taskTemplateJson", async () => {
    const exec = execFixture({
      rule: {
        isActive: true,
        messageTemplate: null,
        taskTemplateJson: { title: "Call {{lead.firstName}}", dueInDays: 2, priority: "HIGH" },
      },
    });
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([exec] as never);

    const result = await processPendingFollowUps();

    expect(result.sent).toBe(1);
    expect(vi.mocked(prisma.task.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: "lead1",
          title: "Call Ada",
          priority: "HIGH",
          dueAt: expect.any(Date),
        }),
      }),
    );
  });

  it("marks an execution FAILED when the SMS provider throws", async () => {
    const exec = execFixture();
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([exec] as never);
    sendMessageMock.mockRejectedValue(new Error("twilio rejected"));

    const result = await processPendingFollowUps();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(vi.mocked(prisma.followUpExecution.update)).toHaveBeenCalledWith({
      where: { id: "exec1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "twilio rejected",
        attemptCount: { increment: 1 },
      }),
    });
  });

  it("fails when an SMS rule fires for a lead with no phone", async () => {
    const exec = execFixture({
      lead: { ...execFixture().lead, primaryPhone: "" },
    });
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([exec] as never);

    const result = await processPendingFollowUps();

    expect(result.failed).toBe(1);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("fails an EMAIL rule when no email provider is configured", async () => {
    isEmailConfiguredMock.mockReturnValue(false);
    const exec = execFixture({
      rule: {
        isActive: true,
        messageTemplate: { name: "x", channel: "EMAIL", templateBody: "y" },
        taskTemplateJson: null,
      },
    });
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([exec] as never);

    const result = await processPendingFollowUps();

    expect(result.failed).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("counts processed/sent/failed/cancelled across a mixed batch", async () => {
    const ok = execFixture({ id: "ok" });
    const inactive = execFixture({
      id: "inactive",
      rule: { isActive: false, messageTemplate: null, taskTemplateJson: null },
    });
    const fail = execFixture({ id: "fail" });
    vi.mocked(prisma.followUpExecution.findMany).mockResolvedValue([ok, inactive, fail] as never);
    sendMessageMock.mockResolvedValueOnce({ externalId: "x", status: "sent" }).mockRejectedValueOnce(new Error("boom"));

    const result = await processPendingFollowUps();

    expect(result.processed).toBe(3);
    expect(result.sent).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(1);
  });
});

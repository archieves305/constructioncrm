import { describe, expect, it } from "vitest";
import { appPathFor, chunk, isExpoPushToken, pushMessageFor, shouldPush, tokenIsDead } from "./push";

describe("shouldPush", () => {
  const base = { kind: "task.assigned", deliveryClass: "DIGEST", reason: "assignee", created: true };
  it("buzzes an assignment, even one the email side keeps for the digest", () => {
    expect(shouldPush(base)).toBe(true);
    expect(shouldPush({ ...base, kind: "task.mentioned", deliveryClass: "IMMEDIATE" })).toBe(true);
  });
  it("never buzzes the person who made the change", () => {
    expect(shouldPush({ ...base, reason: "actor" })).toBe(false);
  });
  it("never buzzes twice for the same event in a window", () => {
    expect(shouldPush({ ...base, created: false })).toBe(false);
  });
  it("leaves routine activity to the digest and the bell", () => {
    expect(shouldPush({ ...base, kind: "task.completed" })).toBe(false);
    expect(shouldPush({ ...base, kind: "task.checklist_updated" })).toBe(false);
    expect(shouldPush({ ...base, deliveryClass: "IN_APP_ONLY" })).toBe(false);
  });
});

describe("pushMessageFor", () => {
  it("says what happened and where, nothing else", () => {
    expect(pushMessageFor("task.assigned", "3310 NE 37 St, Fort Lauderdale", "/task/t1")).toEqual({
      title: "New task",
      body: "3310 NE 37 St, Fort Lauderdale",
      data: { path: "/task/t1" },
    });
  });
  it("without an address only says what happened", () => {
    expect(pushMessageFor("task.mentioned", null, "/").body).toBe("Open KNU Field to see it.");
  });
});

describe("helpers", () => {
  it("links to the task, else the job, else the app", () => {
    expect(appPathFor({ taskId: "t1", jobId: "j1" })).toBe("/task/t1");
    expect(appPathFor({ jobId: "j1" })).toBe("/job/j1");
    expect(appPathFor({})).toBe("/");
  });
  it("accepts only Expo push tokens", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abcdefghijk_-123]")).toBe(true);
    expect(isExpoPushToken("not-a-token")).toBe(false);
    expect(isExpoPushToken(42)).toBe(false);
  });
  it("splits into Expo's batches of 100", () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 50]);
  });
  it("drops a token Apple or Google no longer knows", () => {
    expect(tokenIsDead({ status: "error", details: { error: "DeviceNotRegistered" } })).toBe(true);
    expect(tokenIsDead({ status: "error", details: { error: "MessageRateExceeded" } })).toBe(false);
    expect(tokenIsDead({ status: "ok" })).toBe(false);
  });
});

import { appPathFor as pathFor2 } from "./push";
describe("crew submission pushes", () => {
  it("open the review screen", () => {
    expect(pathFor2({ jobId: "j1" }, "crew.submission")).toBe("/crew-submissions");
    expect(pathFor2({ jobId: "j1" })).toBe("/job/j1");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { envRef } = vi.hoisted(() => ({ envRef: { CRON_SECRET: undefined as string | undefined } }));
vi.mock("@/lib/env", () => ({ env: envRef }));

const { requireCronSecret } = await import("./auth");

function req(header?: string) {
  return new NextRequest("http://localhost/api/cron/x", {
    method: "POST",
    headers: header ? { "x-cron-secret": header } : {},
  });
}

beforeEach(() => {
  envRef.CRON_SECRET = undefined;
});

describe("requireCronSecret", () => {
  it("503s when the server has no secret — nothing could ever pass", () => {
    const res = requireCronSecret(req("anything"));
    expect(res?.status).toBe(503);
  });
  it("403s a wrong or missing header", () => {
    envRef.CRON_SECRET = "s3cret";
    expect(requireCronSecret(req("nope"))?.status).toBe(403);
    expect(requireCronSecret(req())?.status).toBe(403);
  });
  it("lets a matching header through", () => {
    envRef.CRON_SECRET = "s3cret";
    expect(requireCronSecret(req("s3cret"))).toBeNull();
  });
});

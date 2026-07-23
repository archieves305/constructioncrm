import { describe, expect, it, vi } from "vitest";

// Unauthenticated: every request below has no session token.
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(async () => null),
}));

import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function run(path: string) {
  return middleware(new NextRequest(new URL(`https://crm.careyos.com${path}`)));
}

describe("middleware public path allowlist", () => {
  // Paths that customers, email recipients and machine callers reach with no
  // session. A regression here fails silently: the caller is 307'd to /login
  // and gets a login page instead of the endpoint. That is exactly how
  // /api/email/unsubscribe was broken — it renders its own HTML, verifies its
  // own HMAC token and rate-limits itself, but middleware never let it run.
  const publicPaths = [
    "/login",
    "/co/TOKEN",
    "/action/TOKEN",
    "/api/co/TOKEN/decision",
    "/api/auth/session",
    "/api/track/TOKEN",
    "/api/cron/follow-ups",
    "/api/integrations/cc-allocator/jobs",
    "/api/email/unsubscribe?token=abc.def",
    "/forgot-password",
    "/reset-password",
  ];

  for (const path of publicPaths) {
    it(`lets ${path} through without a session`, async () => {
      const res = await run(path);
      expect(res.headers.get("location")).toBeNull();
    });
  }

  it("still redirects a protected path to /login", async () => {
    const res = await run("/jobs");
    expect(res.headers.get("location")).toContain("/login");
  });
});

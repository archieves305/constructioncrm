import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

// Middleware reads these from process.env directly rather than importing
// src/lib/env, to keep the edge bundle from carrying whole-environment
// validation. Set the public origin so the return-path assertions are explicit
// rather than depending on vitest.setup's NEXTAUTH_URL fallback.
beforeAll(() => {
  process.env.APP_BASE_URL = "https://crm.careyos.com";
});

function run(path: string, opts: { session?: boolean } = {}) {
  const req = new NextRequest(new URL(`https://crm.careyos.com${path}`));
  if (opts.session) {
    req.cookies.set("careyos_session", "opaque-token");
  }
  return middleware(req);
}

describe("middleware public path allowlist", () => {
  // Paths that customers, email recipients and machine callers reach with no
  // session. A regression here fails silently: the caller is redirected to the
  // portal and gets a login page instead of the endpoint. That is exactly how
  // /api/email/unsubscribe was broken — it renders its own HTML, verifies its
  // own HMAC token and rate-limits itself, but middleware never let it run.
  const publicPaths = [
    "/login",
    "/co/TOKEN",
    "/action/TOKEN",
    "/api/co/TOKEN/decision",
    "/api/auth/sign-out",
    "/api/track/TOKEN",
    "/api/cron/follow-ups",
    "/api/integrations/cc-allocator/jobs",
    "/api/email/unsubscribe?token=abc.def",
  ];

  for (const path of publicPaths) {
    it(`lets ${path} through without a session`, () => {
      expect(run(path).headers.get("location")).toBeNull();
    });
  }
});

describe("middleware session gate", () => {
  it("sends an anonymous visitor to the CareyOS portal, not a local login", () => {
    const location = run("/jobs").headers.get("location");
    expect(location).toContain("app.careyos.com/login");
  });

  it("preserves where the user was going, including the query string", () => {
    const location = run("/jobs?stage=won").headers.get("location") ?? "";
    const next = new URL(location).searchParams.get("next");
    expect(next).toBe("https://crm.careyos.com/jobs?stage=won");
  });

  it("does not redirect when the shared session cookie is present", () => {
    expect(run("/jobs", { session: true }).headers.get("location")).toBeNull();
  });

  // Middleware intentionally does not verify the cookie — that is the portal's
  // job, done server-side per request. A forged cookie gets past this gate and
  // is then refused by getSession(), which fails closed.
  it("does not attempt to validate the cookie itself", () => {
    expect(
      run("/admin", { session: true }).headers.get("location"),
    ).toBeNull();
  });
});

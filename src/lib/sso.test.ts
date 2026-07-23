import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined,
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    CAREYOS_SSO_URL: "https://app.careyos.com",
    CAREYOS_APP_ID: "construction-crm",
    CAREYOS_SSO_DEV_BYPASS: undefined,
    APP_BASE_URL: "https://crm.careyos.com",
  },
}));

import { introspect, loginUrl, logoutUrl, SESSION_COOKIE } from "./sso";

function portalReturns(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  cookieStore.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("introspect", () => {
  it("is denied with no session cookie, and never calls the portal", async () => {
    const fetchSpy = portalReturns({});
    vi.stubGlobal("fetch", fetchSpy);

    expect(await introspect()).toEqual({ ok: false, allowed: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a granted user, taking appRole from the top level", async () => {
    cookieStore.set(SESSION_COOKIE, "tok");
    vi.stubGlobal(
      "fetch",
      portalReturns({
        ok: true,
        allowed: true,
        appRole: "CREW_LEAD",
        user: { uid: "u1", email: "Frank@Knuconstruction.com", role: "USER" },
      }),
    );

    const result = await introspect();
    expect(result.allowed).toBe(true);
    // Email is lower-cased so it matches the CRM's unique index.
    expect(result.user?.email).toBe("frank@knuconstruction.com");
    expect(result.user?.appRole).toBe("CREW_LEAD");
    expect(result.user?.portalRole).toBe("USER");
  });

  it("forwards the token as a bearer against the right app id", async () => {
    cookieStore.set(SESSION_COOKIE, "tok");
    const fetchSpy = portalReturns({
      ok: true,
      allowed: true,
      appRole: "ADMIN",
      user: { uid: "u1", email: "a@b.com", role: "ADMIN" },
    });
    vi.stubGlobal("fetch", fetchSpy);

    await introspect();

    const [url, init] = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    expect(url).toBe(
      "https://app.careyos.com/api/sso/authorize?app=construction-crm",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    expect(init.cache).toBe("no-store");
  });

  it("reports an authenticated but ungranted user as not allowed", async () => {
    cookieStore.set(SESSION_COOKIE, "tok");
    vi.stubGlobal(
      "fetch",
      portalReturns({
        ok: true,
        allowed: false,
        appRole: null,
        user: { uid: "u1", email: "a@b.com", role: "USER" },
      }),
    );

    const result = await introspect();
    expect(result.ok).toBe(true);
    expect(result.allowed).toBe(false);
  });

  // Every failure path must deny rather than admit. A network blip or a portal
  // outage must not become an open door.
  it("fails closed on a non-2xx from the portal", async () => {
    cookieStore.set(SESSION_COOKIE, "tok");
    vi.stubGlobal("fetch", portalReturns({ ok: false }, false));
    expect(await introspect()).toEqual({ ok: false, allowed: false });
  });

  it("fails closed when the portal is unreachable", async () => {
    cookieStore.set(SESSION_COOKIE, "tok");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    expect(await introspect()).toEqual({ ok: false, allowed: false });
  });

  it("fails closed on a malformed body", async () => {
    cookieStore.set(SESSION_COOKIE, "tok");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch);
    expect(await introspect()).toEqual({ ok: false, allowed: false });
  });

  it("fails closed when ok is true but the user is missing", async () => {
    cookieStore.set(SESSION_COOKIE, "tok");
    vi.stubGlobal("fetch", portalReturns({ ok: true, allowed: true }));
    expect(await introspect()).toEqual({ ok: false, allowed: false });
  });
});

describe("portal URLs", () => {
  it("round-trips the user back to where they were going", () => {
    const url = new URL(loginUrl("/jobs/123"));
    expect(url.origin + url.pathname).toBe("https://app.careyos.com/login");
    expect(url.searchParams.get("next")).toBe(
      "https://crm.careyos.com/jobs/123",
    );
  });

  it("defaults to the CRM root for a missing or non-relative path", () => {
    expect(new URL(loginUrl()).searchParams.get("next")).toBe(
      "https://crm.careyos.com/",
    );
    expect(
      new URL(loginUrl("https://evil.example.com")).searchParams.get("next"),
    ).toBe("https://crm.careyos.com/");
  });

  it("points logout at the portal", () => {
    expect(logoutUrl()).toBe("https://app.careyos.com/api/auth/logout");
  });
});

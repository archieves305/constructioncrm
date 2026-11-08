import { describe, expect, it } from "vitest";
import {
  canManageMobileDevices,
  hashToken,
  lastSeenIsStale,
  revokeRequest,
  toDeviceDto,
  tokenRefused,
} from "./devices";
import { compareVersions, needsUpdate, registerDeviceRequest } from "@/lib/mobile-api";

describe("hashToken", () => {
  it("is sha256 hex and never the token itself", () => {
    const h = hashToken("abc");
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(h).not.toContain("abc");
  });
});

describe("tokenRefused", () => {
  const live = { endedAt: null, device: { revokedAt: null } };
  it("allows an unknown token and a live one", () => {
    expect(tokenRefused(null)).toBeNull();
    expect(tokenRefused(live)).toBeNull();
  });
  it("refuses every token of a revoked phone", () => {
    expect(tokenRefused({ ...live, device: { revokedAt: new Date() } })).toBe("device_revoked");
  });
  it("refuses a token signed out on the phone", () => {
    expect(tokenRefused({ ...live, endedAt: new Date() })).toBe("signed_out");
  });
  it("names the revoke when both apply", () => {
    expect(tokenRefused({ endedAt: new Date(), device: { revokedAt: new Date() } })).toBe("device_revoked");
  });
});

describe("registerDeviceRequest", () => {
  const ok = { installationId: "3f1c9a2e-7b4d-4e0a-9c1f-2d8e6b5a4c3b", platform: "ios", appVersion: "0.1.0" };
  it("accepts a well-formed registration", () => {
    expect(registerDeviceRequest.safeParse(ok).success).toBe(true);
    expect(registerDeviceRequest.safeParse({ ...ok, deviceName: " Richard's iPhone " }).data?.deviceName).toBe(
      "Richard's iPhone",
    );
  });
  it("refuses a bad installation id, platform or version", () => {
    expect(registerDeviceRequest.safeParse({ ...ok, installationId: "short" }).success).toBe(false);
    expect(registerDeviceRequest.safeParse({ ...ok, installationId: "a b c d e f g h" }).success).toBe(false);
    expect(registerDeviceRequest.safeParse({ ...ok, platform: "windows" }).success).toBe(false);
    expect(registerDeviceRequest.safeParse({ ...ok, appVersion: "1.0" }).success).toBe(false);
  });
});

describe("versions", () => {
  it("compares by number, not by text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "1.3.0")).toBe(-1);
  });
  it("asks for an update only below the minimum", () => {
    expect(needsUpdate("0.1.0", "0.2.0")).toBe(true);
    expect(needsUpdate("0.2.0", "0.2.0")).toBe(false);
    expect(needsUpdate("1.0.0", "0.2.0")).toBe(false);
  });
});

describe("the rest", () => {
  it("requires a reason to revoke", () => {
    expect(revokeRequest.safeParse({ reason: "" }).success).toBe(false);
    expect(revokeRequest.safeParse({ reason: "Phone lost on site" }).success).toBe(true);
  });
  it("lets only ADMIN and MANAGER manage phones", () => {
    expect(canManageMobileDevices("ADMIN")).toBe(true);
    expect(canManageMobileDevices("MANAGER")).toBe(true);
    for (const r of ["OFFICE_STAFF", "SALES_REP", "CREW_LEAD", "MARKETING", "READ_ONLY"]) {
      expect(canManageMobileDevices(r)).toBe(false);
    }
  });
  it("refreshes last seen at most every ten minutes", () => {
    const t = new Date("2026-11-08T12:00:00Z");
    expect(lastSeenIsStale(new Date("2026-11-08T11:55:00Z"), t)).toBe(false);
    expect(lastSeenIsStale(new Date("2026-11-08T11:50:00Z"), t)).toBe(true);
  });
  it("shapes a device for the API", () => {
    const d = toDeviceDto({
      id: "d1",
      platform: "android",
      appVersion: "0.1.0",
      deviceName: null,
      lastSeenAt: new Date("2026-11-08T12:00:00Z"),
      createdAt: new Date("2026-11-08T11:00:00Z"),
      revokedAt: null,
    });
    expect(d).toEqual({
      id: "d1",
      platform: "android",
      appVersion: "0.1.0",
      deviceName: null,
      lastSeenAt: "2026-11-08T12:00:00.000Z",
      createdAt: "2026-11-08T11:00:00.000Z",
      revokedAt: null,
    });
  });
});

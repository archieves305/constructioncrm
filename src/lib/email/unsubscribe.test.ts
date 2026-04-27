import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    NEXTAUTH_SECRET: "test_placeholder_secret_test_placeholder_secret",
    NEXTAUTH_URL: "https://crm.example.com",
  },
}));

import {
  buildUnsubscribeUrl,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe";

describe("unsubscribe tokens", () => {
  it("round-trips a leadId through generate → verify", () => {
    const token = generateUnsubscribeToken("lead123");
    expect(verifyUnsubscribeToken(token)).toBe("lead123");
  });

  it("rejects a token with a tampered payload", () => {
    const token = generateUnsubscribeToken("lead123");
    const [_payload, sig] = token.split(".");
    const tampered = `${Buffer.from("evil-lead", "utf8").toString("base64url")}.${sig}`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("rejects a token with a tampered signature", () => {
    const token = generateUnsubscribeToken("lead123");
    const [payload] = token.split(".");
    const tampered = `${payload}.YWFhYWFhYWE`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("a.b.c")).toBeNull();
  });

  it("builds an absolute URL using NEXTAUTH_URL", () => {
    const url = buildUnsubscribeUrl("lead123");
    expect(url.startsWith("https://crm.example.com/api/email/unsubscribe?token=")).toBe(true);
  });
});

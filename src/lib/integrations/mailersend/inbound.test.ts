import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inboundMessageOf, MAILERSEND_TEST_SECRET, verifyInboundSignature } from "./inbound";

const sign = (secret: string, raw: string) => createHmac("sha256", secret).update(raw).digest("hex");

describe("verifyInboundSignature", () => {
  const raw = JSON.stringify({ type: "inbound.message", data: { id: "m1" } });
  it("accepts the route's own signature", () => {
    expect(verifyInboundSignature(raw, sign("route-secret-123", raw), "route-secret-123")).toBe("valid");
  });
  it("recognises the validation ping", () => {
    expect(verifyInboundSignature(raw, sign(MAILERSEND_TEST_SECRET, raw), "route-secret-123")).toBe("test");
  });
  it("refuses anything else", () => {
    expect(verifyInboundSignature(raw, sign("other", raw), "route-secret-123")).toBe("invalid");
    expect(verifyInboundSignature(raw + " ", sign("route-secret-123", raw), "route-secret-123")).toBe("invalid");
    expect(verifyInboundSignature(raw, null, "route-secret-123")).toBe("invalid");
  });
});

describe("inboundMessageOf", () => {
  it("reads the message", () => {
    const m = inboundMessageOf({ type: "inbound.message", data: { id: "abc", from: { email: "no-reply@buildingconnected.com", name: "Kaufman Lynn via BuildingConnected" }, subject: "Invitation to Bid", text: "hi", html: "<p>hi</p>", date: "Mon, 12 Oct 2026 14:00:00 +0000" } });
    expect(m).toMatchObject({ id: "abc", from: "no-reply@buildingconnected.com", fromName: "Kaufman Lynn via BuildingConnected", subject: "Invitation to Bid", text: "hi" });
    expect(m?.receivedAt.toISOString()).toBe("2026-10-12T14:00:00.000Z");
  });
  it("is null for a ping or junk", () => {
    expect(inboundMessageOf({ type: "webhook.test", message: "ok" })).toBeNull();
    expect(inboundMessageOf("x")).toBeNull();
  });
});

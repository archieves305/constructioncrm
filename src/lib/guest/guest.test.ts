import { describe, expect, it } from "vitest";
import { hashGuestToken, looksLikeGuestToken, newGuestToken } from "./token";
import { answerSchemas, GUEST_TEXT, linkMessage, linkState, LINK_LIFETIME_MS, photosNeeded } from "./purposes";

describe("guest link codes", () => {
  it("are 43 url-safe characters, different each time, stored only as a hash", () => {
    const a = newGuestToken();
    const b = newGuestToken();
    expect(a).not.toBe(b);
    expect(looksLikeGuestToken(a)).toBe(true);
    expect(hashGuestToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGuestToken(a)).not.toContain(a);
    expect(looksLikeGuestToken("../../etc")).toBe(false);
  });
});

describe("link state", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const base = { expiresAt: new Date(now.getTime() + 1000), revokedAt: null, submittedAt: null };
  it("open, expired, used, revoked (revoked wins)", () => {
    expect(linkState(base, now)).toBe("open");
    expect(linkState({ ...base, expiresAt: now }, now)).toBe("expired");
    expect(linkState({ ...base, submittedAt: now }, now)).toBe("used");
    expect(linkState({ ...base, submittedAt: now, revokedAt: now }, now)).toBe("revoked");
  });
  it("confirmations last 72 hours, photos and payment a week", () => {
    expect(LINK_LIFETIME_MS.INSTALL_CONFIRM).toBe(72 * 3_600_000);
    expect(LINK_LIFETIME_MS.CREW_PAYMENT).toBe(7 * 24 * 3_600_000);
  });
});

describe("answers", () => {
  it("each purpose takes only its own answer", () => {
    expect(answerSchemas.CREW_PAYMENT.safeParse({ amount: 4000 }).success).toBe(true);
    expect(answerSchemas.CREW_PAYMENT.safeParse({ amount: -5 }).success).toBe(false);
    expect(answerSchemas.INSTALL_CONFIRM.safeParse({ answer: "maybe" }).success).toBe(false);
    expect(photosNeeded("CREW_PHOTOS").min).toBe(1);
    expect(photosNeeded("INSTALL_CONFIRM").max).toBe(0);
  });
  it("the message is in the crew's language and carries the link", () => {
    const en = linkMessage("CREW_PAYMENT", "en", { name: "Neville", street: "2188 Wind Trace", url: "https://crm.careyos.com/g/abc" });
    expect(en).toBe("Hi Neville, you can request payment for 2188 Wind Trace here, with photos of the work: https://crm.careyos.com/g/abc — KNU Construction");
    const es = linkMessage("INSTALL_CONFIRM", "es", { name: "Jesús", street: "3001 SW 23 Ter", url: "https://x/g/y", when: "martes 10 de noviembre" });
    expect(es).toContain("Hola Jesús, por favor confirme que puede estar en 3001 SW 23 Ter el martes 10 de noviembre: https://x/g/y");
  });
  it("Spanish has every English phrase", () => {
    expect(Object.keys(GUEST_TEXT.es).sort()).toEqual(Object.keys(GUEST_TEXT.en).sort());
  });
});

import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptWithKeyring,
  encryptWithKeyring,
  maskSsn,
  normalizeSsn,
  parseKeyring,
  type Keyring,
} from "./field-encryption";

function testKeyring(versions: number[] = [1]): Keyring {
  const raw = versions
    .map((v) => `v${v}:${randomBytes(32).toString("base64")}`)
    .join(",");
  return parseKeyring(raw);
}

describe("parseKeyring", () => {
  it("parses a single key and picks it as active", () => {
    const ring = testKeyring([1]);
    expect(ring.activeVersion).toBe(1);
    expect(ring.keys.size).toBe(1);
  });

  it("picks the highest version as active regardless of order", () => {
    const raw = [
      `v3:${randomBytes(32).toString("base64")}`,
      `v1:${randomBytes(32).toString("base64")}`,
    ].join(",");
    expect(parseKeyring(raw).activeVersion).toBe(3);
  });

  it("tolerates whitespace around entries", () => {
    const raw = ` v1:${randomBytes(32).toString("base64")} , v2:${randomBytes(32).toString("base64")} `;
    expect(parseKeyring(raw).keys.size).toBe(2);
  });

  it("rejects malformed entries", () => {
    expect(() => parseKeyring("not-a-key")).toThrow(/must look like/);
  });

  it("rejects keys that are not 32 bytes", () => {
    const raw = `v1:${randomBytes(16).toString("base64")}`;
    expect(() => parseKeyring(raw)).toThrow(/32 bytes/);
  });

  it("rejects duplicate versions", () => {
    const raw = `v1:${randomBytes(32).toString("base64")},v1:${randomBytes(32).toString("base64")}`;
    expect(() => parseKeyring(raw)).toThrow(/duplicate/);
  });

  it("rejects an empty keyring", () => {
    expect(() => parseKeyring("")).toThrow(/no keys/);
  });
});

describe("encrypt/decrypt round-trip", () => {
  it("round-trips a value under the same AAD", () => {
    const ring = testKeyring();
    const { ciphertext, keyVersion } = encryptWithKeyring(
      ring,
      "123456789",
      "personnel:abc",
    );
    expect(keyVersion).toBe(1);
    expect(ciphertext).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(decryptWithKeyring(ring, ciphertext, "personnel:abc")).toBe(
      "123456789",
    );
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", () => {
    const ring = testKeyring();
    const a = encryptWithKeyring(ring, "123456789", "personnel:abc");
    const b = encryptWithKeyring(ring, "123456789", "personnel:abc");
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails on AAD mismatch (ciphertext moved to another row)", () => {
    const ring = testKeyring();
    const { ciphertext } = encryptWithKeyring(ring, "123456789", "personnel:abc");
    expect(() =>
      decryptWithKeyring(ring, ciphertext, "personnel:OTHER"),
    ).toThrow();
  });

  it("fails on a tampered auth tag", () => {
    const ring = testKeyring();
    const { ciphertext } = encryptWithKeyring(ring, "123456789", "personnel:abc");
    const parts = ciphertext.split(":");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    expect(() =>
      decryptWithKeyring(ring, parts.join(":"), "personnel:abc"),
    ).toThrow();
  });

  it("fails on tampered ciphertext bytes", () => {
    const ring = testKeyring();
    const { ciphertext } = encryptWithKeyring(ring, "123456789", "personnel:abc");
    const parts = ciphertext.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64");
    expect(() =>
      decryptWithKeyring(ring, parts.join(":"), "personnel:abc"),
    ).toThrow();
  });

  it("fails with a wrong key", () => {
    const ringA = testKeyring();
    const ringB = testKeyring();
    const { ciphertext } = encryptWithKeyring(ringA, "123456789", "personnel:abc");
    expect(() =>
      decryptWithKeyring(ringB, ciphertext, "personnel:abc"),
    ).toThrow();
  });

  it("rejects malformed ciphertext strings", () => {
    const ring = testKeyring();
    expect(() => decryptWithKeyring(ring, "garbage", "aad")).toThrow(
      /Malformed/,
    );
    expect(() => decryptWithKeyring(ring, "v1:a:b", "aad")).toThrow(
      /Malformed/,
    );
  });

  it("decrypts old-version ciphertext after rotation, encrypts with new", () => {
    const v1 = `v1:${randomBytes(32).toString("base64")}`;
    const oldRing = parseKeyring(v1);
    const { ciphertext: oldCt } = encryptWithKeyring(
      oldRing,
      "123456789",
      "personnel:abc",
    );

    const rotated = parseKeyring(`${v1},v2:${randomBytes(32).toString("base64")}`);
    expect(decryptWithKeyring(rotated, oldCt, "personnel:abc")).toBe(
      "123456789",
    );
    const fresh = encryptWithKeyring(rotated, "123456789", "personnel:abc");
    expect(fresh.keyVersion).toBe(2);
  });

  it("errors clearly when the ciphertext version is missing from the ring", () => {
    const ringV2 = parseKeyring(`v2:${randomBytes(32).toString("base64")}`);
    const ringV1 = testKeyring([1]);
    const { ciphertext } = encryptWithKeyring(ringV1, "123456789", "aad");
    expect(() => decryptWithKeyring(ringV2, ciphertext, "aad")).toThrow(
      /No key for ciphertext version v1/,
    );
  });
});

describe("normalizeSsn", () => {
  it("strips dashes and spaces", () => {
    expect(normalizeSsn("123-45-6789")).toBe("123456789");
    expect(normalizeSsn(" 123 45 6789 ")).toBe("123456789");
  });

  it("rejects wrong lengths", () => {
    expect(normalizeSsn("12345678")).toBeNull();
    expect(normalizeSsn("1234567890")).toBeNull();
    expect(normalizeSsn("")).toBeNull();
    expect(normalizeSsn("abc")).toBeNull();
  });
});

describe("maskSsn", () => {
  it("formats the masked display value", () => {
    expect(maskSsn("6789")).toBe("•••-••-6789");
  });
});

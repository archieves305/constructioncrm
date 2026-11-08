import * as Crypto from "expo-crypto";

/** base64 → base64url without padding. */
export function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return globalThis.btoa(bin);
}

/** A fresh PKCE pair (RFC 7636, S256): 32 random bytes → 43-character verifier. */
export async function newPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = toUrlSafe(bytesToBase64(Crypto.getRandomBytes(32)));
  const challenge = toUrlSafe(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  return { verifier, challenge };
}

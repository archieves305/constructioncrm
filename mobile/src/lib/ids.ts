import * as Crypto from "expo-crypto";

/** A phone-made record id the CRM accepts (CLIENT_ID in the shared contracts): "c" + 24 hex characters. */
export function clientId(): string {
  return "c" + Crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

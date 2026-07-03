// Client-generated entry ids for offline-idempotent saves. Isomorphic
// (browser + Node via globalThis.crypto): "c" + 30 hex chars = 31 chars,
// matching clientCuidSchema (/^[a-z][a-z0-9]{19,31}$/) and Prisma cuid
// column shape.
export function newEntryId(): string {
  const bytes = new Uint8Array(15);
  globalThis.crypto.getRandomValues(bytes);
  return "c" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

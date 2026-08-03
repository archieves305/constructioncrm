/**
 * @mention parsing for task notes.
 *
 * Deliberately matches against the real user list rather than regex-guessing
 * name shapes. "@Mary Beth Olsen" and "@o'brien" defeat a naive `@(\w+)`
 * pattern, and a mention that silently fails to resolve is worse than no
 * mention at all — the author believes they pulled someone in and moves on.
 *
 * Two rules do the real work:
 *
 *  1. At each "@", the LONGEST handle wins. Frank Ruiz's email local part is
 *     "frank", which would otherwise swallow the "@Frank" in "@Frank Delgado"
 *     and notify the wrong man alongside the right one.
 *  2. A handle claimed by more than one person resolves to NOBODY. With two
 *     Franks, "@Frank" mails neither; the composer's autocomplete is what
 *     steers the author to a full name. Guessing would mail the wrong person,
 *     which is worse than mailing no one.
 */

export type MentionableUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

/** Every string a person might reasonably be addressed by. */
function handlesFor(user: MentionableUser): string[] {
  const first = user.firstName.trim();
  const last = user.lastName.trim();
  const local = (user.email.split("@")[0] ?? "").trim();

  return [
    last ? `${first} ${last}` : "",
    last ? `${first}.${last}` : "",
    last ? `${first}${last}` : "",
    local,
    first,
  ].filter(Boolean);
}

/**
 * Characters that, appearing straight after a match, mean we matched a
 * fragment rather than a whole handle — so "@Frank" does not fire inside
 * "@Frankie". "." is deliberately absent: trailing sentence punctuation is
 * normal ("@Frank."), and "@frank.ruiz" is already handled by longest-first.
 */
const CONTINUES_WORD = /[\w'’-]/;

/**
 * Returns the ids of users mentioned in `body`, in first-appearance order.
 * A user is returned at most once however many times they are named.
 */
export function parseMentions(body: string, users: MentionableUser[]): string[] {
  if (!body.includes("@")) return [];

  const claims = new Map<string, Set<string>>();
  for (const user of users) {
    for (const handle of handlesFor(user)) {
      const key = handle.toLowerCase();
      let owners = claims.get(key);
      if (!owners) claims.set(key, (owners = new Set()));
      owners.add(user.id);
    }
  }

  const unambiguous = new Map<string, string>();
  for (const [handle, owners] of claims) {
    if (owners.size === 1) unambiguous.set(handle, [...owners][0]);
  }

  const byLongest = [...unambiguous.keys()].sort((a, b) => b.length - a.length);
  const lower = body.toLowerCase();

  const found: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "@") continue;
    for (const handle of byLongest) {
      if (!lower.startsWith(handle, i + 1)) continue;
      const next = body[i + 1 + handle.length];
      if (next && CONTINUES_WORD.test(next)) continue;
      const userId = unambiguous.get(handle)!;
      if (!seen.has(userId)) {
        seen.add(userId);
        found.push(userId);
      }
      break;
    }
  }

  return found;
}

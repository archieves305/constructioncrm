// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubBreadcrumb, scrubEvent, stripQuery } from "./sentry-scrub";

test("a crash report keeps the person's id only, and no request or extras", () => {
  const e = scrubEvent({
    request: { data: "{secret}" },
    extra: { body: "x" },
    user: { id: "u1", email: "richard@example.com", username: "Richard", ip_address: "1.2.3.4" },
  });
  assert.deepEqual(e, { user: { id: "u1" } });
});

test("breadcrumbs lose query strings, bodies, console text, tokens and emails", () => {
  assert.equal(stripQuery("https://crm.careyos.com/api/tasks?assignedUserId=u1#x"), "https://crm.careyos.com/api/tasks");
  assert.equal(scrubBreadcrumb({ category: "console", message: "anything" }), null);
  const c = scrubBreadcrumb({ category: "fetch", message: "Bearer abcdef1234567890 for bob@knu.com", data: { url: "https://x/api?q=1", method: "GET", body: "{}" } });
  assert.deepEqual(c, { category: "fetch", message: "Bearer [token] for [email]", data: { url: "https://x/api", method: "GET" } });
});

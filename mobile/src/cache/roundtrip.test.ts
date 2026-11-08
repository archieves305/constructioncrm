// Run: npm test
// The saved copy's trip as the phone makes it: dehydrate → JSON → restore
// into a fresh client (a relaunch), with the app's own rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { keepQueries, shouldPersist } from "./rules";

test("a relaunch without signal opens on what was saved", async () => {
  const before = new QueryClient();
  await before.prefetchQuery({ queryKey: ["job", "j1"], queryFn: async () => ({ id: "j1", jobNumber: "JOB-00001" }) });
  await before.prefetchQuery({ queryKey: ["tasks", "job", "j1"], queryFn: async () => [{ id: "t1" }] });
  await before.prefetchQuery({ queryKey: ["job", "bad"], queryFn: async () => { throw new Error("no") }, retry: false });
  await before.prefetchQuery({ queryKey: ["secret"], queryFn: async () => "not for the phone" });
  const saved = JSON.stringify(dehydrate(before, { shouldDehydrateQuery: (x) => x.state.status === "success" && shouldPersist(x.queryKey) }));
  before.clear();

  const after = new QueryClient();
  const parsed = JSON.parse(saved);
  hydrate(after, { mutations: [], queries: keepQueries(parsed.queries, Date.now()) });
  assert.deepEqual(after.getQueryData(["job", "j1"]), { id: "j1", jobNumber: "JOB-00001" });
  assert.deepEqual(after.getQueryData(["tasks", "job", "j1"]), [{ id: "t1" }]);
  assert.equal(after.getQueryState(["job", "bad"]), undefined);
  assert.equal(after.getQueryData(["secret"]), undefined);
  assert.equal(after.getQueryState(["job", "j1"])?.status, "success");
  after.clear();
});

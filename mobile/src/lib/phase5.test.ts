// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { contractName, contractTotals, dollars, parseAmount } from "./crewpay";
import { materialsText, materialsTitle } from "./materials";

test("a crew contract's totals include its change orders", () => {
  const c = { contractAmount: 259870, changeOrders: [{ amount: 1500 }, { amount: -500 }], payments: [{ amount: 142903.52 }, { amount: 14032.99 }] };
  assert.deepEqual(contractTotals(c as never), { total: 260870, paid: 156936.51, remaining: 103933.49 });
  assert.equal(contractName({ label: "Tile guy", crew: null, vendor: null }), "Tile guy");
  assert.equal(contractName({ label: null, crew: { name: "BNW" }, vendor: { name: "BNW LLC" } }), "BNW");
});

test("amounts typed and shown", () => {
  assert.equal(parseAmount("$4,000.50"), 4000.5);
  assert.equal(parseAmount(" 250 "), 250);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(dollars(103933.49), "$103,933.49");
});

test("material lines become the request's title and text", () => {
  const lines = [
    { qty: "12", unit: "sheets", item: "5/8 drywall" },
    { qty: "2", unit: "boxes", item: "1-5/8 screws" },
    { qty: "", unit: "", item: "" },
  ];
  assert.equal(materialsTitle(lines), "12 sheets 5/8 drywall + 1 more");
  assert.equal(materialsText(lines, "Fri, Nov 13", "Front driveway", "Gate code 1234"), "• 12 sheets 5/8 drywall\n• 2 boxes 1-5/8 screws\n\nNeeded on site by Fri, Nov 13.\n\nDeliver to: Front driveway\n\nGate code 1234");
  assert.equal(materialsTitle([{ qty: "", unit: "", item: "" }]), "");
});

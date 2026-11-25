// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { areaFindings, areaLine, boxOnScreen, severityTone } from "./inspector";

test("puts a box where the photo is drawn (contain, letterboxed)", () => {
  // a 2000 × 1500 photo in a 400 × 400 frame: scale 0.2, 50 px bars top and bottom
  assert.deepEqual(boxOnScreen({ x1: 100, y1: 0, x2: 600, y2: 500 }, { width: 2000, height: 1500 }, { width: 400, height: 400 }), { left: 20, top: 50, width: 100, height: 100 });
  // portrait in a wide frame: bars at the sides
  assert.deepEqual(boxOnScreen({ x1: 0, y1: 0, x2: 1500, y2: 2000 }, { width: 1500, height: 2000 }, { width: 400, height: 200 }), { left: 125, top: 0, width: 150, height: 200 });
});

test("colours by severity", () => {
  assert.equal(severityTone("CRITICAL"), "danger");
  assert.equal(severityTone("COSMETIC"), "neutral");
});

const area = { id: "a", name: "Kitchen", trade: null, tradeLabel: null, verdict: "looks_complete", summary: null, photosNeeded: [], photoCount: 2, openFindings: 0 };
let n = 0;
const photo = (state: "waiting" | "analysing" | "failed" | "done") => ({ id: `p${n++}`, fileId: "f", url: "/x", areaId: "a", width: 1, height: 1, quality: null, state });
const finding = (review: "PROPOSED" | "CONFIRMED" | "DISMISSED", severity: "CRITICAL" | "MAJOR" | "MINOR" | "COSMETIC" = "MINOR", resolved = false) => ({
  id: `f${n++}`, areaId: "a", photoId: null, source: "AI", kind: "OBSERVED", tradeLabel: "x", title: "t", evidence: "e", severity, confidence: 0.5, action: null, physicalCheck: null, boxes: [], review, resolved, punch: null,
});

test("says what an area needs next", () => {
  assert.equal(areaLine(area, [], []), "No photos yet");
  assert.equal(areaLine(area, [photo("done"), photo("analysing")], []), "2 photos · analysing 1");
  assert.equal(areaLine(area, [photo("done")], [finding("PROPOSED")]), "1 to look at");
  assert.equal(areaLine(area, [photo("done")], [finding("CONFIRMED")]), "1 to fix");
  assert.equal(areaLine(area, [photo("done")], [finding("CONFIRMED", "MINOR", true)]), "Looks complete");
});

test("orders an area's findings worst first, dismissed last", () => {
  const list = areaFindings([finding("DISMISSED", "CRITICAL"), finding("PROPOSED", "MINOR"), finding("PROPOSED", "MAJOR")], "a");
  assert.deepEqual(list.map((f) => [f.review, f.severity]), [["PROPOSED", "MAJOR"], ["PROPOSED", "MINOR"], ["DISMISSED", "CRITICAL"]]);
});

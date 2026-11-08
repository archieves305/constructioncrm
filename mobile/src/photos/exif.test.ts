// Run: npx tsx --test src/photos/exif.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { takenAtFromExif } from "./exif";

test("uses the camera's own zone when it gives one", () => {
  assert.equal(
    takenAtFromExif({ DateTimeOriginal: "2026:11:08 14:03:22", OffsetTimeOriginal: "-05:00" }),
    "2026-11-08T19:03:22.000Z",
  );
});

test("reads the iOS nested form", () => {
  assert.equal(
    takenAtFromExif({ "{Exif}": { DateTimeOriginal: "2026:11:08 14:03:22", OffsetTimeOriginal: "+00:00" } }),
    "2026-11-08T14:03:22.000Z",
  );
});

test("without a zone, reads it as the phone's local time", () => {
  const expected = new Date(2026, 10, 8, 14, 3, 22).toISOString();
  assert.equal(takenAtFromExif({ DateTimeOriginal: "2026:11:08 14:03:22" }), expected);
});

test("nothing usable gives null", () => {
  assert.equal(takenAtFromExif(null), null);
  assert.equal(takenAtFromExif({}), null);
  assert.equal(takenAtFromExif({ DateTimeOriginal: "garbage" }), null);
});

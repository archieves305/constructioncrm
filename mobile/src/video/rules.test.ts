// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { duration, videoName, videoTooBig, videoTooLong } from "./rules";

test("names, lengths, sizes", () => {
  assert.equal(videoName(new Date(2026, 10, 8, 14, 5, 9)), "Video 2026-11-08 14-05-09.mp4");
  assert.equal(videoTooLong(299), null);
  assert.equal(videoTooLong(null), null);
  assert.match(videoTooLong(9 * 60) ?? "", /9 minutes.*up to 5 minutes/);
  assert.equal(videoTooBig(80 * 1024 * 1024), null);
  assert.match(videoTooBig(120 * 1024 * 1024) ?? "", /120 MB; the limit is 95 MB/);
  assert.equal(duration(125), "2:05");
  assert.equal(duration(null), "");
});

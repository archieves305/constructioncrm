import { describe, expect, it } from "vitest";
import { mergeTimeline, type JobEvent } from "./timeline";

const ev = (id: string, iso: string, kind: JobEvent["kind"] = "task"): JobEvent => ({ id, kind, at: new Date(iso), title: id });

describe("mergeTimeline", () => {
  it("merges every source newest first", () => {
    const out = mergeTimeline([
      [ev("stage:1", "2026-10-01T10:00:00Z", "stage")],
      [ev("payment:1", "2026-10-02T09:00:00Z", "payment"), ev("payment:0", "2026-09-20T09:00:00Z", "payment")],
      [ev("task:1", "2026-10-01T15:00:00Z")],
    ]);
    expect(out.map((e) => e.id)).toEqual(["payment:1", "task:1", "stage:1", "payment:0"]);
  });

  it("caps the list, keeping the newest", () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`task:${i}`, new Date(Date.UTC(2026, 9, 1, i)).toISOString()));
    const out = mergeTimeline([many], 5);
    expect(out).toHaveLength(5);
    expect(out[0].id).toBe("task:29");
  });

  it("drops duplicates and rows with no usable date", () => {
    const out = mergeTimeline([[ev("a", "2026-10-01T00:00:00Z"), ev("a", "2026-10-01T00:00:00Z")], [{ ...ev("b", "nope") }]]);
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("orders same-instant events deterministically", () => {
    const out = mergeTimeline([[ev("b", "2026-10-01T00:00:00Z"), ev("a", "2026-10-01T00:00:00Z")]]);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

import { describe, expect, it } from "vitest";
import { boardRedirectUrl } from "./board-redirect";

describe("boardRedirectUrl", () => {
  it("adds view=board and forwards every param, repeated ones included", () => {
    expect(boardRedirectUrl("/leads", {})).toBe("/leads?view=board");
    expect(boardRedirectUrl("/jobs", { scope: "all", q: "wind" })).toBe("/jobs?scope=all&q=wind&view=board");
    expect(boardRedirectUrl("/leads", { service: ["a", "b"], x: undefined })).toBe("/leads?service=a&service=b&view=board");
  });
  it("a stale view param is overridden", () => {
    expect(boardRedirectUrl("/jobs", { view: "table" })).toBe("/jobs?view=board");
  });
});

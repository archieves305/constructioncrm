import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/fetch-json";
import { errorStatus, queryStatus } from "./query-status";

describe("queryStatus", () => {
  it("is loading while nothing has arrived", () => {
    expect(queryStatus({ isPending: true, isLoading: true })).toBe("loading");
    expect(queryStatus({ isPending: true, isLoading: false })).toBe("loading");
  });
  it("a refusal is forbidden, never empty", () => {
    expect(queryStatus({ isError: true, error: new HttpError(403, "Forbidden") })).toBe("forbidden");
    expect(queryStatus({ isError: true, error: new HttpError(401, "Unauthorized") })).toBe("forbidden");
  });
  it("a missing record is not found", () => {
    expect(queryStatus({ isError: true, error: new HttpError(404, "Not found") })).toBe("not_found");
    expect(queryStatus({ isError: true, error: new HttpError(410, "Gone") })).toBe("not_found");
  });
  it("anything else failed", () => {
    expect(queryStatus({ isError: true, error: new HttpError(500, "boom") })).toBe("failed");
    expect(queryStatus({ isError: true, error: new TypeError("Failed to fetch") })).toBe("failed");
    expect(queryStatus({ isError: true, error: new HttpError(400, "bad") })).toBe("failed");
  });
  it("ready once data is there, even null", () => {
    expect(queryStatus({ data: [] })).toBe("ready");
    expect(queryStatus({ data: null })).toBe("ready");
  });
  it("reads the status off anything shaped like an HttpError", () => {
    expect(errorStatus({ status: 404 })).toBe(404);
    expect(errorStatus(new Error("x"))).toBeNull();
    expect(errorStatus(null)).toBeNull();
  });
});

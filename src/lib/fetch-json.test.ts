import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchJson, HttpError, retryServerErrors } from "./fetch-json";

function respond(status: number, body: unknown, json = true): Response {
  return new Response(json ? JSON.stringify(body) : String(body), {
    status,
    headers: { "Content-Type": json ? "application/json" : "text/html" },
  });
}

function mockFetch(response: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns the parsed body on success", async () => {
    mockFetch(respond(200, { id: "job_1" }));
    await expect(fetchJson("/api/jobs/job_1")).resolves.toEqual({ id: "job_1" });
  });

  it("throws HttpError carrying the status instead of returning the error body", async () => {
    mockFetch(respond(404, { error: "Job not found" }));
    await expect(fetchJson("/api/jobs/nope")).rejects.toMatchObject({
      status: 404,
      message: "Job not found",
    });
  });

  it("distinguishes a missing record from a failing server", async () => {
    mockFetch(respond(500, { error: "boom" }));
    const err = await fetchJson("/api/jobs/job_1").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.isNotFound).toBe(false);
  });

  it("falls back to a generic message when the body is not JSON", async () => {
    mockFetch(respond(502, "<html>bad gateway</html>", false));
    await expect(fetchJson("/api/jobs/job_1")).rejects.toThrow("Request failed (502)");
  });
});

describe("retryServerErrors", () => {
  it("does not retry a 404", () => {
    expect(retryServerErrors(0, new HttpError(404, "Job not found"))).toBe(false);
  });

  it("retries a 500 up to twice", () => {
    expect(retryServerErrors(0, new HttpError(500, "boom"))).toBe(true);
    expect(retryServerErrors(2, new HttpError(500, "boom"))).toBe(false);
  });

  it("retries a network fault", () => {
    expect(retryServerErrors(0, new TypeError("Failed to fetch"))).toBe(true);
  });
});

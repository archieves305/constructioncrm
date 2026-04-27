import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function readLine(spy: ReturnType<typeof vi.spyOn>): LogLine {
    const arg = spy.mock.calls[0]?.[0];
    return JSON.parse(String(arg)) as LogLine;
  }

  type LogLine = {
    ts: string;
    level: "debug" | "info" | "warn" | "error";
    msg: string;
    ctx?: Record<string, unknown>;
    err?: { name: string; message: string; stack?: string };
  };

  it("emits info-level events to stdout as one JSON object per line", () => {
    logger.info("hello", { userId: "u1" });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
    const line = String(stdoutSpy.mock.calls[0][0]);
    expect(line.endsWith("\n")).toBe(true);

    const record = readLine(stdoutSpy);
    expect(record.level).toBe("info");
    expect(record.msg).toBe("hello");
    expect(record.ctx).toEqual({ userId: "u1" });
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("routes warn and error to stderr, not stdout", () => {
    logger.warn("be careful");
    logger.error("nope");

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("captures Error instances with name, message, and stack via exception()", () => {
    const err = new Error("kaboom");
    logger.exception(err, { route: "/api/x" });

    const record = readLine(stderrSpy);
    expect(record.level).toBe("error");
    expect(record.msg).toBe("kaboom");
    expect(record.err?.name).toBe("Error");
    expect(record.err?.message).toBe("kaboom");
    expect(record.err?.stack).toContain("kaboom");
    expect(record.ctx).toEqual({ route: "/api/x" });
  });

  it("handles non-Error values passed to exception()", () => {
    logger.exception("bare string failure");
    const record = readLine(stderrSpy);
    expect(record.err?.name).toBe("NonError");
    expect(record.err?.message).toBe("bare string failure");
  });

  it("omits ctx and err when not provided", () => {
    logger.info("ping");
    const record = readLine(stdoutSpy);
    expect(record.ctx).toBeUndefined();
    expect(record.err).toBeUndefined();
  });
});

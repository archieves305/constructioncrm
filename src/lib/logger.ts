type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

type LogRecord = {
  ts: string;
  level: LogLevel;
  msg: string;
  ctx?: LogContext;
  err?: { name: string; message: string; stack?: string };
};

function emit(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === "warn" || record.level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

function serializeError(value: unknown): LogRecord["err"] {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return { name: "NonError", message: String(value) };
}

export const logger = {
  debug(msg: string, ctx?: LogContext): void {
    emit({ ts: new Date().toISOString(), level: "debug", msg, ctx });
  },
  info(msg: string, ctx?: LogContext): void {
    emit({ ts: new Date().toISOString(), level: "info", msg, ctx });
  },
  warn(msg: string, ctx?: LogContext): void {
    emit({ ts: new Date().toISOString(), level: "warn", msg, ctx });
  },
  error(msg: string, ctx?: LogContext): void {
    emit({ ts: new Date().toISOString(), level: "error", msg, ctx });
  },
  exception(error: unknown, ctx?: LogContext): void {
    emit({
      ts: new Date().toISOString(),
      level: "error",
      msg: error instanceof Error ? error.message : String(error),
      ctx,
      err: serializeError(error),
    });
  },
};

export type { LogLevel, LogContext };

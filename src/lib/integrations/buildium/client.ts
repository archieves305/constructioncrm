import { env } from "@/lib/env";

export class BuildiumError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "BuildiumError";
  }
}

export class BuildiumNotConfiguredError extends Error {
  constructor() {
    super(
      "Buildium is not configured. Set BUILDIUM_CLIENT_ID and BUILDIUM_CLIENT_SECRET.",
    );
    this.name = "BuildiumNotConfiguredError";
  }
}

export function isBuildiumConfigured(): boolean {
  return Boolean(env.BUILDIUM_CLIENT_ID && env.BUILDIUM_CLIENT_SECRET);
}

function assertConfigured() {
  if (!isBuildiumConfigured()) throw new BuildiumNotConfiguredError();
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

export async function buildiumRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  assertConfigured();

  const url = new URL(
    path.startsWith("/") ? path.slice(1) : path,
    env.BUILDIUM_BASE_URL.endsWith("/")
      ? env.BUILDIUM_BASE_URL
      : env.BUILDIUM_BASE_URL + "/",
  );
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      "x-buildium-client-id": env.BUILDIUM_CLIENT_ID!,
      "x-buildium-client-secret": env.BUILDIUM_CLIENT_SECRET!,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const base = `Buildium ${options.method ?? "GET"} ${path} ${res.status}`;
    let detail = "";
    if (parsed && typeof parsed === "object") {
      const p = parsed as {
        UserMessage?: string;
        Message?: string;
        Errors?: Array<
          | { PropertyName?: string; Message?: string; Key?: string; Value?: string }
          | string
        >;
      };
      const msg = p.UserMessage || p.Message;
      const errs = Array.isArray(p.Errors)
        ? p.Errors.map((e) => {
            if (typeof e === "string") return e;
            const field = e.PropertyName ?? e.Key;
            const text = e.Message ?? e.Value;
            return [field, text].filter(Boolean).join(": ");
          }).join("; ")
        : "";
      detail = [msg, errs].filter(Boolean).join(" — ");
    }
    if (!detail && typeof parsed === "string") detail = parsed;
    console.error(`[buildium] ${base}`, parsed);
    throw new BuildiumError(detail ? `${base}: ${detail}` : base, res.status, parsed);
  }

  return parsed as T;
}

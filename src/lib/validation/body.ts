import { NextRequest, NextResponse } from "next/server";
import { z, ZodError, ZodTypeAny } from "zod";

export type ValidateBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export async function validateBody<S extends ZodTypeAny>(
  req: NextRequest | Request,
  schema: S,
): Promise<ValidateBodyResult<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Validation failed",
          fields: formatZodErrors(parsed.error),
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

function formatZodErrors(err: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "_root";
    (fields[path] ??= []).push(issue.message);
  }
  return fields;
}

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateBody } from "./body";
import type { NextRequest } from "next/server";

function jsonReq(body: string): NextRequest {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }) as unknown as NextRequest;
}

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0),
});

describe("validateBody", () => {
  it("returns parsed data when the body matches the schema", async () => {
    const r = await validateBody(
      jsonReq(JSON.stringify({ email: "a@b.com", age: 30 })),
      schema,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ email: "a@b.com", age: 30 });
    }
  });

  it("returns 400 when the body is malformed JSON", async () => {
    const r = await validateBody(jsonReq("{not json"), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      const body = await r.response.json();
      expect(body.error).toBe("Invalid JSON body");
    }
  });

  it("returns 400 with field errors when validation fails", async () => {
    const r = await validateBody(
      jsonReq(JSON.stringify({ email: "not-an-email", age: -1 })),
      schema,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      const body = await r.response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.fields.email).toBeTruthy();
      expect(body.fields.age).toBeTruthy();
    }
  });

  it("rejects unknown root types under root key", async () => {
    const arrSchema = z.object({ x: z.string() });
    const r = await validateBody(jsonReq(JSON.stringify(["a", "b"])), arrSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const body = await r.response.json();
      expect(body.fields).toBeDefined();
    }
  });

  it("strips unknown extra keys when schema is strict", async () => {
    const strictSchema = z.object({ a: z.string() }).strict();
    const r = await validateBody(
      jsonReq(JSON.stringify({ a: "ok", extra: "boom" })),
      strictSchema,
    );
    expect(r.ok).toBe(false);
  });

  it("infers types correctly", async () => {
    const r = await validateBody(
      jsonReq(JSON.stringify({ email: "a@b.com", age: 5 })),
      schema,
    );
    if (r.ok) {
      const _email: string = r.data.email;
      const _age: number = r.data.age;
      void _email;
      void _age;
    }
  });
});

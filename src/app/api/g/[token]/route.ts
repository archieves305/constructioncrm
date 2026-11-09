import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { GuestError, submitGuest } from "@/lib/guest/service";

/**
 * POST /api/g/[token] — a crew's answer through a guest link (public, no
 * sign-in). Multipart: `answer` (JSON) and up to 10 `photos`. The link allows
 * one submission; nothing takes effect until the office accepts it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = enforceRateLimit(request, { name: "guest-submit", limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const { token } = await params;
  let answer: unknown;
  let photos: File[];
  try {
    const form = await request.formData();
    answer = JSON.parse(String(form.get("answer") ?? "{}"));
    photos = form.getAll("photos").filter((x): x is File => typeof x === "object" && x !== null && "arrayBuffer" in x);
  } catch {
    return NextResponse.json({ error: "Check the form and try again" }, { status: 400 });
  }
  try {
    await submitGuest(token, answer, photos);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof GuestError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyWorkAuth } from "@/lib/integrations/work/auth";
import { cancelFromWork } from "@/lib/integrations/work/service";
import { workError } from "../../respond";

// PATCH /api/integrations/work/tasks/:id  { status: "CANCELLED", actingEmail }
// The only change Work may make, and only to a task it created.
const body = z.object({ status: z.literal("CANCELLED"), actingEmail: z.string().trim().email() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authFail = verifyWorkAuth(request);
  if (authFail) return authFail;
  const { id } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Only { status: \"CANCELLED\", actingEmail } is accepted" }, { status: 400 });
  try {
    return NextResponse.json({ task: await cancelFromWork(id, parsed.data.actingEmail) });
  } catch (e) {
    return workError(e, "tasks:patch");
  }
}

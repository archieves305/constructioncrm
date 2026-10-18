import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { templateBytes } from "@/lib/permit-intel/forms";
import { errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The blank form itself (a public municipal form), for the preview. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "CREW_LEAD") return forbidden();
  const { id } = await params;
  try {
    const { bytes, fileName } = await templateBytes(id);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName.replace(/[^\w.\- ]+/g, "_")}"`, "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    return errorResponse(err);
  }
}

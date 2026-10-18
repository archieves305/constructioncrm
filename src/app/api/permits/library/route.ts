import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { searchLibrary } from "@/lib/permit-intel/library";

/** Permit documents across jobs (the viewer's job scope), filtered and searched in full text. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "CREW_LEAD") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = request.nextUrl.searchParams;
  const day = (k: string) => {
    const v = p.get(k);
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const from = day("from");
  const to = day("to");
  if (from === undefined || to === undefined) return badRequest("from / to must be dates");
  const q = p.get("q");
  if (q && q.length > 200) return badRequest("The search is too long");
  return NextResponse.json(
    await searchLibrary(
      { q, jurisdictionId: p.get("jurisdictionId"), permitTypeKey: p.get("permitTypeKey"), docType: p.get("docType"), submittedOnly: p.get("submitted") === "1", from, to: to ? new Date(to.getTime() + 86_399_999) : null },
      session.user,
    ),
  );
}

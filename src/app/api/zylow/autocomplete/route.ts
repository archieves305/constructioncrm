import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { zylowClient } from "@/lib/services/zylow/client";
import { zylowErrorResponse } from "@/lib/services/zylow/http";
import { autocompleteQuerySchema } from "@/lib/validators/zylow";

// Address typeahead. Cache-only on Zylow's side — never charges a REAPI credit,
// so it's safe to fire on (debounced) keystrokes. Returns lightweight
// suggestions; the client then calls /api/zylow/property/[id] for full detail.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const parsed = autocompleteQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  try {
    const data = await zylowClient.autocomplete(parsed.data.q, parsed.data.limit);
    return NextResponse.json(data);
  } catch (err) {
    return zylowErrorResponse(err, { route: "zylow/autocomplete" });
  }
}

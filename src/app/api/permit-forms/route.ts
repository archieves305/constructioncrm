import { NextRequest, NextResponse, after } from "next/server";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { createTemplate, listTemplates, runMapping } from "@/lib/permit-intel/forms";
import { templateMetaSchema } from "@/lib/permit-intel/form-validation";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";
import { MAX_UPLOAD_BYTES } from "@/lib/files/storage";

/** The form templates (Admin → Permits → Forms). */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  return NextResponse.json(await listTemplates());
}

/** Upload a blank fillable form: its fields are read at once. Multipart: file, name, jurisdictionId?, county?, permitTypeKeys (repeated)? */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("Choose the blank form (a PDF)");
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return badRequest(`The form must be a PDF under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const meta = templateMetaSchema.safeParse({
    name: form!.get("name") || file.name.replace(/\.pdf$/i, ""),
    jurisdictionId: form!.get("jurisdictionId") || null,
    county: form!.get("county") || null,
    permitTypeKeys: form!.getAll("permitTypeKeys").filter((v): v is string => typeof v === "string" && !!v),
  });
  if (!meta.success) return badRequest(meta.error.issues.map((i) => i.message).join("; "));
  try {
    const t = await createTemplate({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, meta.data, actorOf(session.user));
    // a flat form's blanks are found now, after the answer
    if (t.mapState === "MAPPING") {
      const userId = session.user.id;
      after(() => runMapping(t.id, userId));
    }
    return NextResponse.json(t, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

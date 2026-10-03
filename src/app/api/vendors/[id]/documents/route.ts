import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { canManageVendors, VENDOR_DENIED_MESSAGE } from "@/lib/vendors/access";
import { vendorErrorResponse } from "@/lib/vendors/validation";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from "@/lib/files/storage";
import { createDocument, VENDOR_DOC_TYPES } from "@/lib/vendors/documents";

type DocType = (typeof VENDOR_DOC_TYPES)[number];
const text = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

/** Add a compliance document: its type and dates, and the file when there is one. Multipart. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageVendors(session.user.role)) return NextResponse.json({ error: VENDOR_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const form = await request.formData().catch(() => null);
  if (!form) return badRequest("Expected a form");
  const type = form.get("type");
  if (typeof type !== "string" || !(VENDOR_DOC_TYPES as readonly string[]).includes(type)) return badRequest("Choose what kind of document this is");

  const upload = form.get("file");
  let file: { buffer: Buffer; name: string; mime: string } | null = null;
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > MAX_UPLOAD_BYTES) return badRequest(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    if (!ALLOWED_MIME.has(upload.type)) return badRequest(`That file type cannot be uploaded: ${upload.type || "unknown"}`);
    file = { buffer: Buffer.from(await upload.arrayBuffer()), name: upload.name, mime: upload.type };
  }

  try {
    const doc = await createDocument(
      id,
      {
        type: type as DocType,
        carrier: text(form.get("carrier"), 200),
        policyNumber: text(form.get("policyNumber"), 120),
        effectiveDate: text(form.get("effectiveDate"), 10),
        expiresAt: text(form.get("expiresAt"), 10),
        notes: text(form.get("notes"), 2000),
      },
      file,
      session.user.id,
    );
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return vendorErrorResponse(err);
  }
}

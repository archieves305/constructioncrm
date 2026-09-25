import { NextResponse } from "next/server";
import { MissingFieldsError, NotFoundError } from "@/lib/contracts/generate";
import { logger } from "@/lib/logger";
import { ContractError } from "./service";
import { TemplateVersioningError } from "./templates";
import type { ContractFailure } from "./state";

const STATUS: Record<ContractFailure, number> = {
  not_found: 404,
  expired: 410,
  already_signed: 409,
  already_decided: 409,
  not_sent: 409,
  not_draft: 409,
  already_void: 409,
  signed_exists: 409,
  sent_exists: 409,
  no_email: 400,
  applications_issued: 409,
  validation: 400,
};

/** One place that turns the service's errors into HTTP, so every route agrees. */
export function contractErrorResponse(err: unknown, where: string): NextResponse {
  if (err instanceof ContractError) {
    return NextResponse.json({ error: err.message, reason: err.reason, details: err.details ?? undefined }, { status: STATUS[err.reason] });
  }
  if (err instanceof TemplateVersioningError) {
    return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof MissingFieldsError) {
    return NextResponse.json({ error: `Cannot generate the contract yet: ${err.fields.join(", ")}`, reason: "validation", fields: err.fields }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message, reason: "not_found" }, { status: 404 });
  }
  logger.exception(err, { where });
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export function pdfResponse(buffer: Buffer, fileName: string, disposition: "inline" | "attachment" = "inline"): NextResponse {
  const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

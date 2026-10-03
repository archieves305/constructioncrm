import { z } from "zod";
import { NextResponse } from "next/server";
import { VendorError } from "./service";

export const VENDOR_KINDS = ["SUBCONTRACTOR", "SUPPLIER", "OTHER"] as const;

const text = (max: number) => z.string().max(max).nullable().optional();

export const vendorFields = {
  name: z.string().trim().min(2, "Give the vendor a name").max(120),
  kind: z.enum(VENDOR_KINDS),
  trade: text(120),
  contactName: text(120),
  phone: text(40),
  email: z.union([z.string().email("That email does not look right").max(200), z.literal(""), z.null()]).optional(),
  address: text(300),
  notes: text(5000),
};

/** What a vendor is being connected to: a payee spelling, a crew, or a contractor name typed on labor contracts. */
export const linkSchema = z.object({
  payee: z.string().max(200).nullable().optional(),
  crewId: z.string().max(60).nullable().optional(),
  contractLabel: z.string().max(200).nullable().optional(),
});

export const createVendorSchema = z.object({ ...vendorFields, link: linkSchema.optional() });

export const updateVendorSchema = z.object({ ...vendorFields, isActive: z.boolean() }).partial();

/** Turn a service refusal into its response; anything else is rethrown. */
export function vendorErrorResponse(err: unknown): NextResponse {
  if (err instanceof VendorError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}

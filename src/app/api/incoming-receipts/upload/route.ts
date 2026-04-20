import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { parseCsv, rowsToObjects } from "@/lib/csv-parse";
import { findMatchingJobs } from "@/lib/receipts/matcher";
import { linkReceiptToJob } from "@/lib/receipts/link-to-job";

function parseDate(s: string): Date | null {
  const trimmed = s.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const us = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(trimmed);
  if (us) {
    const [, mo, d, y] = us;
    let year = +y;
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    const dt = new Date(Date.UTC(year, +mo - 1, +d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

type Result = {
  created: number;
  autoMatched: number;
  unmatched: number;
  skipped: number;
  errors: string[];
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("file is required");

  const text = await file.text();
  const rows = parseCsv(text);
  const objects = rowsToObjects(rows);
  if (objects.length === 0) return badRequest("CSV is empty or missing header row");

  const headers = Object.keys(objects[0] || {});

  const pick = (row: Record<string, string>, keys: string[]): string => {
    for (const k of keys) {
      const v = row[k];
      if (v && v.trim()) return v.trim();
    }
    return "";
  };

  const VENDOR_KEYS = ["vendor", "vendor name", "store", "store name", "merchant"];
  const DATE_KEYS = [
    "date",
    "purchase date",
    "order date",
    "transaction date",
    "date of purchase",
    "invoice date",
  ];
  const AMOUNT_KEYS = [
    "amount",
    "total",
    "total amount",
    "grand total",
    "invoice total",
    "transaction amount",
  ];
  const PO_KEYS = [
    "po",
    "po #",
    "po number",
    "po name",
    "job name",
    "project",
    "project name",
    "reference",
    "job",
    "job #",
  ];
  const REF_KEYS = [
    "reference",
    "invoice",
    "invoice #",
    "invoice number",
    "transaction id",
    "transaction #",
    "order #",
    "order number",
  ];
  const NOTES_KEYS = ["notes", "description", "items", "memo"];

  const result: Result = {
    created: 0,
    autoMatched: 0,
    unmatched: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 0; i < objects.length; i += 1) {
    const row = objects[i];
    const lineNo = i + 2;

    const vendor = pick(row, VENDOR_KEYS);
    const po = pick(row, PO_KEYS);
    const dateStr = pick(row, DATE_KEYS);
    const amountStr = pick(row, AMOUNT_KEYS).replace(/[$,\s]/g, "");
    const reference = pick(row, REF_KEYS);
    const notes = pick(row, NOTES_KEYS);

    const missing: string[] = [];
    if (!vendor) missing.push("vendor");
    if (!dateStr) missing.push("date");
    if (!amountStr) missing.push("amount");
    if (missing.length > 0) {
      result.errors.push(
        `Line ${lineNo}: missing ${missing.join(", ")} (headers found: ${headers.join(", ")})`,
      );
      result.skipped += 1;
      continue;
    }

    const amount = Number(amountStr);
    if (Number.isNaN(amount) || amount < 0) {
      result.errors.push(`Line ${lineNo}: invalid amount "${amountStr}"`);
      result.skipped += 1;
      continue;
    }

    const purchaseDate = parseDate(dateStr);
    if (!purchaseDate) {
      result.errors.push(`Line ${lineNo}: invalid date "${dateStr}" (expected M/D/YYYY or YYYY-MM-DD)`);
      result.skipped += 1;
      continue;
    }

    const receipt = await prisma.incomingReceipt.create({
      data: {
        vendor,
        poText: po || null,
        purchaseDate,
        amount,
        reference: reference || null,
        notes: notes || null,
        uploadedByUserId: session.user.id,
      },
    });
    result.created += 1;

    const matches = await findMatchingJobs(po);
    if (matches.length === 1) {
      try {
        await linkReceiptToJob(receipt.id, matches[0], session.user.id);
        result.autoMatched += 1;
      } catch (err) {
        result.errors.push(
          `Line ${lineNo}: match failed — ${err instanceof Error ? err.message : String(err)}`,
        );
        result.unmatched += 1;
      }
    } else {
      result.unmatched += 1;
    }
  }

  return NextResponse.json(result);
}

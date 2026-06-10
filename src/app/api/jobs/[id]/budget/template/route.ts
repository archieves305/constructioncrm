import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { toCsv } from "@/lib/csv";

// GET /api/jobs/[id]/budget/template — a CSV the user can fill in and re-upload.
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const csv = toCsv(
    [
      { category: "Demo", name: "Tear-out", budget: 3000 },
      { category: "Roof", name: "Roof replacement", budget: 9000 },
      { category: "Kitchen", name: "Cabinets + install", budget: 12000 },
    ],
    [
      { key: "category", header: "Category" },
      { key: "name", header: "Line item" },
      { key: "budget", header: "Budget" },
    ],
  );

  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="budget-template.csv"',
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

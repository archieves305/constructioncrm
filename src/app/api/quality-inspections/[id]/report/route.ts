import { NextRequest, NextResponse } from "next/server";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { renderInspectionReport } from "@/lib/inspector/report-load";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/quality-inspections/[id]/report — the inspection report PDF:
// confirmed findings only, whoever asks. `?download=1` saves it instead of
// opening it in the browser.
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  try {
    const { pdf, fileName } = await renderInspectionReport(g.viewer, id);
    const ab = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(ab).set(pdf);
    const disposition = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(ab, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return inspectorFailure(err, "GET /api/quality-inspections/[id]/report");
  }
}

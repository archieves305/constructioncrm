import { NextRequest, NextResponse } from "next/server";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { startOptions } from "@/lib/inspector/service";

/** The set-up sheet's choices; with ?jobId= the job's rooms and contractors (checked as starting one there). */
export async function GET(request: NextRequest) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  try {
    return NextResponse.json(await startOptions(g.viewer, request.nextUrl.searchParams.get("jobId")));
  } catch (err) {
    return inspectorFailure(err, "GET /api/quality-inspections/options");
  }
}

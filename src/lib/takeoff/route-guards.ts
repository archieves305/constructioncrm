import { NextResponse } from "next/server";
import type { SessionUser } from "@/lib/auth/helpers";
import { guardLead } from "@/lib/access/records";
import { canDeletePlanSet, canEditTakeoff, PLAN_SET_DELETE_DENIED, TAKEOFF_EDIT_DENIED } from "./access";
import { jobLead, planSetLead, sheetLead } from "./service";
import { measurementLead, takeoffLead } from "./takeoff-service";

/**
 * Every takeoff route answers to the lead the record hangs on: the viewer must
 * be able to read that lead (own-only roles get 404 outside their leads), and
 * writing needs the edit role on top. Null means allowed.
 */
type Mode = "read" | "write" | "delete";

function roleGate(user: SessionUser, mode: Mode): NextResponse | null {
  if (mode === "write" && !canEditTakeoff(user.role)) return NextResponse.json({ error: TAKEOFF_EDIT_DENIED }, { status: 403 });
  if (mode === "delete" && !canDeletePlanSet(user.role)) return NextResponse.json({ error: PLAN_SET_DELETE_DENIED }, { status: 403 });
  return null;
}

const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 });

export async function guardLeadForTakeoff(user: SessionUser, leadId: string, mode: Mode): Promise<NextResponse | null> {
  return roleGate(user, mode) ?? (await guardLead(user, leadId, mode === "read" ? "read" : "write"));
}

export async function guardPlanSet(user: SessionUser, planSetId: string, mode: Mode): Promise<NextResponse | null> {
  const gate = roleGate(user, mode);
  if (gate) return gate;
  const set = await planSetLead(planSetId);
  if (!set) return notFound("Plan set");
  return guardLead(user, set.leadId, mode === "read" ? "read" : "write");
}

export async function guardSheet(user: SessionUser, sheetId: string, mode: Mode): Promise<NextResponse | null> {
  const gate = roleGate(user, mode);
  if (gate) return gate;
  const s = await sheetLead(sheetId);
  if (!s) return notFound("Sheet");
  return guardLead(user, s.leadId, mode === "read" ? "read" : "write");
}

export async function guardTakeoffJob(user: SessionUser, jobId: string, mode: Mode): Promise<NextResponse | null> {
  const gate = roleGate(user, mode);
  if (gate) return gate;
  const j = await jobLead(jobId);
  if (!j) return notFound("Job");
  return guardLead(user, j.leadId, mode === "read" ? "read" : "write");
}

export async function guardTakeoff(user: SessionUser, takeoffId: string, mode: Mode): Promise<NextResponse | null> {
  const gate = roleGate(user, mode);
  if (gate) return gate;
  const t = await takeoffLead(takeoffId);
  if (!t) return notFound("Takeoff");
  return guardLead(user, t.leadId, mode === "read" ? "read" : "write");
}

export async function guardMeasurement(user: SessionUser, measurementId: string, mode: Mode): Promise<NextResponse | null> {
  const gate = roleGate(user, mode);
  if (gate) return gate;
  const m = await measurementLead(measurementId);
  if (!m) return notFound("Measurement");
  return guardLead(user, m.leadId, mode === "read" ? "read" : "write");
}

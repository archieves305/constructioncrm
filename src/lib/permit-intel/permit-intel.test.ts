import { describe, expect, it } from "vitest";
import { canDeleteFile, canEditFile, permitLockOf } from "@/lib/files/access";
import { contentMatchesType } from "@/lib/files/sniff";
import { subjectLabel } from "@/lib/labels/subject";
import { canManagePermitSettings, canSubmitPermit } from "./access";
import { jurisdictionKey, jurisdictionKindFor, permitTypeKeyFor, sameJurisdictionName, tidyJurisdictionName } from "./catalog";
import { isPermitDocType, permitDocLabel, PERMIT_DOC_TYPES } from "./doc-types";
import { applicableRequirements, checklistSummary, requirementChecklist, specificity, type RequirementRow } from "./requirements";
import { nextCycle, planManifest, statusForOutcome } from "./submission-plan";
import { jurisdictionPatchSchema, requirementPatchSchema, requirementSchema } from "./validation";

describe("catalog", () => {
  it("reads the permit types typed on prod's three permits", () => {
    expect(permitTypeKeyFor("Re-Roof")).toBe("reroof");
    expect(permitTypeKeyFor("Interior Renovation")).toBe("interior_renovation");
    expect(permitTypeKeyFor("Electrical, Mechanical, Plumbing, and Building")).toBe("building");
    expect(permitTypeKeyFor("Electrical, Plumbing")).toBe("building");
    expect(permitTypeKeyFor("plumbing")).toBe("plumbing");
    expect(permitTypeKeyFor("Impact windows")).toBe("windows_doors");
    expect(permitTypeKeyFor("")).toBeNull();
    expect(permitTypeKeyFor("Fence")).toBeNull();
  });
  it("names jurisdictions the same however they were typed", () => {
    expect(tidyJurisdictionName("City Of Miami")).toBe("City of Miami");
    expect(tidyJurisdictionName("  city of  boynton beach ")).toBe("City of Boynton Beach");
    expect(jurisdictionKey("City of Palm Beach")).toBe("city-of-palm-beach");
    expect(sameJurisdictionName("City Of Miami", "city of miami ")).toBe(true);
    expect(jurisdictionKindFor("Palm Beach County")).toBe("COUNTY");
    expect(jurisdictionKindFor("Town of Jupiter")).toBe("TOWN");
    expect(jurisdictionKindFor("City of Palm Beach")).toBe("CITY");
  });
});

describe("doc types", () => {
  it("has unique keys and labels the unknown", () => {
    expect(new Set(PERMIT_DOC_TYPES.map((t) => t.key)).size).toBe(PERMIT_DOC_TYPES.length);
    expect(isPermitDocType("notice_of_commencement")).toBe(true);
    expect(isPermitDocType("nope")).toBe(false);
    expect(permitDocLabel(null)).toBe("Unclassified");
  });
});

const req = (over: Partial<RequirementRow>): RequirementRow => ({
  id: over.id ?? "r",
  kind: "REQUIREMENT",
  status: "APPROVED",
  jurisdictionId: null,
  permitTypeKey: null,
  title: "Req",
  body: null,
  documentType: null,
  required: true,
  reliability: "INTERNAL",
  sourceUrl: null,
  effectiveFrom: null,
  effectiveTo: null,
  sortOrder: 0,
  ...over,
});

describe("requirements", () => {
  const permit = { jurisdictionId: "pb", permitTypeKey: "reroof" };
  const on = new Date("2026-10-18T12:00:00Z");
  it("ranks a row by how specific it is to the permit", () => {
    expect(specificity(req({}), permit)).toBe(0);
    expect(specificity(req({ permitTypeKey: "reroof" }), permit)).toBe(1);
    expect(specificity(req({ jurisdictionId: "pb" }), permit)).toBe(2);
    expect(specificity(req({ jurisdictionId: "pb", permitTypeKey: "reroof" }), permit)).toBe(3);
    expect(specificity(req({ jurisdictionId: "miami" }), permit)).toBe(-1);
    expect(specificity(req({ permitTypeKey: "plumbing" }), permit)).toBe(-1);
  });
  it("keeps the most specific row per document type, live and approved only", () => {
    const rows = [
      req({ id: "all-app", documentType: "completed_application", sortOrder: 10 }),
      req({ id: "pb-app", jurisdictionId: "pb", documentType: "completed_application", required: false, sortOrder: 10 }),
      req({ id: "noc", permitTypeKey: "reroof", documentType: "notice_of_commencement", sortOrder: 20 }),
      req({ id: "other-city", jurisdictionId: "miami", documentType: "survey" }),
      req({ id: "retired", documentType: "site_plan", status: "RETIRED" }),
      req({ id: "future", documentType: "wind_load", effectiveFrom: new Date("2027-01-01") }),
      req({ id: "expired", documentType: "energy_calculations", effectiveTo: new Date("2026-01-01") }),
      req({ id: "note", title: "Call the reviewer before resubmitting", sortOrder: 30 }),
    ];
    expect(applicableRequirements(rows, permit, on).map((r) => r.id)).toEqual(["pb-app", "noc", "note"]);
  });
  it("is met by a stored file of the type, not by a missing one", () => {
    const reqs = [req({ id: "a", documentType: "completed_application" }), req({ id: "n", documentType: "notice_of_commencement" }), req({ id: "o", documentType: "survey", required: false }), req({ id: "x" })];
    const lines = requirementChecklist(reqs, [
      { id: "f1", fileName: "app.pdf", permitDocType: "completed_application" },
      { id: "f2", fileName: "noc.pdf", permitDocType: "notice_of_commencement", missing: true },
    ]);
    expect(lines.map((l) => l.met)).toEqual([true, false, false, false]);
    expect(checklistSummary(lines)).toEqual({ required: 2, requiredMet: 1, optional: 1, optionalMet: 0 });
  });
});

describe("submission plan", () => {
  it("opens cycle 1, refuses a second while waiting, and follows the answer", () => {
    expect(nextCycle([])).toEqual({ ok: true, number: 1, kind: "INITIAL", reuseCycleId: null });
    expect(nextCycle([{ id: "c1", number: 1, outcome: "PENDING", hasSubmission: true }])).toMatchObject({ ok: false });
    expect(nextCycle([{ id: "c1", number: 1, outcome: "PENDING", hasSubmission: false }])).toEqual({ ok: true, number: 1, kind: "INITIAL", reuseCycleId: "c1" });
    expect(nextCycle([{ id: "c1", number: 1, outcome: "CORRECTIONS", hasSubmission: true }])).toEqual({ ok: true, number: 2, kind: "RESUBMISSION", reuseCycleId: null });
    expect(nextCycle([{ id: "c1", number: 1, outcome: "CORRECTIONS", hasSubmission: true }, { id: "c2", number: 2, outcome: "APPROVED", hasSubmission: true }])).toEqual({ ok: true, number: 3, kind: "REVISION", reuseCycleId: null });
  });
  it("moves the permit with the department's answer", () => {
    expect(statusForOutcome("APPROVED")).toBe("ISSUED");
    expect(statusForOutcome("CORRECTIONS")).toBe("CORRECTIONS");
    expect(statusForOutcome("DENIED")).toBe("DENIED");
    expect(statusForOutcome("WITHDRAWN")).toBe("PREPARING");
    expect(statusForOutcome("PENDING")).toBeNull();
  });
  it("orders and names the entries, and holds back missing files", () => {
    const plan = planManifest([
      { id: "b", fileName: "noc.pdf", permitDocType: "notice_of_commencement", fileSize: 10, missing: false },
      { id: "a", fileName: "app.pdf", permitDocType: "completed_application", fileSize: 20, missing: false },
      { id: "m", fileName: "gone.pdf", permitDocType: "survey", fileSize: 5, missing: true },
    ]);
    expect(plan.entries.map((e) => e.entry)).toEqual(["01 - Completed application - app.pdf", "02 - Notice of commencement - noc.pdf"]);
    expect(plan.missing.map((m) => m.id)).toEqual(["m"]);
  });
});

describe("access", () => {
  it("lets office roles and the permit's own coordinator submit", () => {
    expect(canSubmitPermit({ id: "u", role: "OFFICE_STAFF" }, { assignedUserId: null })).toBe(true);
    expect(canSubmitPermit({ id: "u", role: "SALES_REP" }, { assignedUserId: "u" })).toBe(true);
    expect(canSubmitPermit({ id: "u", role: "SALES_REP" }, { assignedUserId: "v" })).toBe(false);
    expect(canSubmitPermit({ id: "u", role: "SALES_REP" }, { assignedUserId: null })).toBe(false);
    expect(canManagePermitSettings("MANAGER")).toBe(true);
    expect(canManagePermitSettings("OFFICE_STAFF")).toBe(false);
  });
});

describe("file locks", () => {
  const admin = { id: "a", role: "ADMIN" as const };
  const file = { category: "PERMIT" as const, uploadedByUserId: "a" };
  it("locks a document sent in a package, and the issued records", () => {
    expect(permitLockOf({ permitSubmissionCount: 1 })).toBe("submitted");
    expect(permitLockOf({ permitDocType: "stamped_plans" })).toBe("issued");
    expect(permitLockOf({ permitDocType: "survey" })).toBeNull();
    expect(canDeleteFile(admin, { ...file, permitLock: "submitted" }).ok).toBe(false);
    expect(canEditFile(admin, { ...file, permitLock: "issued" }).ok).toBe(false);
    expect(canDeleteFile(admin, { ...file, permitLock: null }).ok).toBe(true);
  });
});

describe("sniff", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("checks the bytes against the claimed type", () => {
    expect(contentMatchesType("application/pdf", bytes("%PDF-1.7\n..."))).toBe(true);
    expect(contentMatchesType("application/pdf", bytes("\n\n%PDF-1.4"))).toBe(true);
    expect(contentMatchesType("application/pdf", bytes("MZ\x90\x00 not a pdf"))).toBe(false);
    expect(contentMatchesType("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(contentMatchesType("image/jpeg", bytes("GIF89a"))).toBe(false);
    expect(contentMatchesType("text/csv", bytes("a,b\n1,2"))).toBe(true);
    expect(contentMatchesType("text/plain", new Uint8Array([0x41, 0, 0x42]))).toBe(false);
    expect(contentMatchesType("application/vnd.ms-excel", bytes("a,b\n1,2"))).toBe(true);
    expect(contentMatchesType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes("PK\x03\x04..."))).toBe(true);
    expect(contentMatchesType("image/heic-sequence", bytes("anything"))).toBe(true);
  });
});

describe("validation", () => {
  it("does not reset unsent fields on a PATCH", () => {
    expect(requirementPatchSchema.parse({ title: "Survey" })).toEqual({ title: "Survey" });
    expect(jurisdictionPatchSchema.parse({ notes: "Portal only" })).toEqual({ notes: "Portal only" });
    expect(requirementSchema.parse({ title: "Survey" })).toMatchObject({ jurisdictionId: null, required: true, reliability: "INTERNAL", sortOrder: 0 });
  });
});

describe("subject label", () => {
  it("names a permit task by the job's address and opens the permit", () => {
    const label = subjectLabel({
      permit: { id: "p1", permitType: "Re-Roof", permitNumber: "B26-1" },
      job: { id: "j1", jobNumber: "JOB-00027", title: "Roof", serviceType: null, lead: { id: "l", kind: "CUSTOMER", fullName: "A", companyName: null, propertyAddress1: "1 Main St", propertyAddress2: null, city: "Palm Beach", state: "FL", zipCode: "33480" } },
    } as Parameters<typeof subjectLabel>[0]);
    expect(label).toMatchObject({ kind: "permit", href: "/permits/p1", primary: expect.stringContaining("1 Main St"), secondary: "Re-Roof permit #B26-1", code: "JOB-00027" });
  });
});

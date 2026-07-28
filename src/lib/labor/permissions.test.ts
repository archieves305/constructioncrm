import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/client";
import {
  NO_GRANTS,
  canAmendApprovedLog,
  canCreatePersonnel,
  canEditLogAtStatus,
  canEditPayRates,
  canManagePersonnel,
  canReadPersonnel,
  canReopenLog,
  canSeeLaborCosts,
  canViewPayroll,
  canViewSensitivePersonnel,
  type FieldGrants,
} from "./permissions";
import { serializePersonnel } from "./serialize";

const ALL_ROLES: RoleName[] = [
  "ADMIN",
  "MANAGER",
  "SALES_REP",
  "OFFICE_STAFF",
  "MARKETING",
  "READ_ONLY",
  "CREW_LEAD",
];

const ALL_GRANTS: FieldGrants = {
  canViewSensitivePersonnel: true,
  canEditPayRates: true,
  canViewPayrollReports: true,
};

describe("personnel access", () => {
  it("office roles manage personnel; field/sales/marketing do not", () => {
    expect(ALL_ROLES.filter(canManagePersonnel)).toEqual([
      "ADMIN",
      "MANAGER",
      "OFFICE_STAFF",
    ]);
  });

  it("crew leads can create basic records (walk-on workers); viewers cannot", () => {
    expect(ALL_ROLES.filter(canCreatePersonnel)).toEqual([
      "ADMIN",
      "MANAGER",
      "OFFICE_STAFF",
      "CREW_LEAD",
    ]);
  });

  it("roster is readable by office + crew lead + read-only, not sales/marketing", () => {
    expect(ALL_ROLES.filter(canReadPersonnel)).toEqual([
      "ADMIN",
      "MANAGER",
      "OFFICE_STAFF",
      "READ_ONLY",
      "CREW_LEAD",
    ]);
  });
});

describe("sensitive data (SSN, W-9/ID docs)", () => {
  it("ADMIN always allowed, even without grants", () => {
    expect(canViewSensitivePersonnel("ADMIN", NO_GRANTS)).toBe(true);
  });

  it("MANAGER/OFFICE_STAFF require the grant", () => {
    for (const role of ["MANAGER", "OFFICE_STAFF"] as const) {
      expect(canViewSensitivePersonnel(role, NO_GRANTS)).toBe(false);
      expect(canViewSensitivePersonnel(role, ALL_GRANTS)).toBe(true);
    }
  });

  it("everyone else is denied even with grants set", () => {
    for (const role of ["SALES_REP", "MARKETING", "READ_ONLY", "CREW_LEAD"] as const) {
      expect(canViewSensitivePersonnel(role, ALL_GRANTS)).toBe(false);
    }
  });
});

describe("rates and payroll", () => {
  it("labor costs visible to office roles only", () => {
    expect(ALL_ROLES.filter(canSeeLaborCosts)).toEqual([
      "ADMIN",
      "MANAGER",
      "OFFICE_STAFF",
    ]);
  });

  it("rate edits: ADMIN implicit; MANAGER/OFFICE_STAFF by grant; others never", () => {
    expect(canEditPayRates("ADMIN", NO_GRANTS)).toBe(true);
    expect(canEditPayRates("MANAGER", NO_GRANTS)).toBe(false);
    expect(canEditPayRates("MANAGER", ALL_GRANTS)).toBe(true);
    expect(canEditPayRates("OFFICE_STAFF", ALL_GRANTS)).toBe(true);
    expect(canEditPayRates("SALES_REP", ALL_GRANTS)).toBe(false);
    expect(canEditPayRates("CREW_LEAD", ALL_GRANTS)).toBe(false);
  });

  it("payroll: ADMIN + OFFICE_STAFF implicit; MANAGER by grant; SALES_REP never (outranks OFFICE_STAFF numerically)", () => {
    expect(canViewPayroll("ADMIN", NO_GRANTS)).toBe(true);
    expect(canViewPayroll("OFFICE_STAFF", NO_GRANTS)).toBe(true);
    expect(canViewPayroll("MANAGER", NO_GRANTS)).toBe(false);
    expect(canViewPayroll("MANAGER", ALL_GRANTS)).toBe(true);
    expect(canViewPayroll("SALES_REP", ALL_GRANTS)).toBe(false);
    expect(canViewPayroll("CREW_LEAD", ALL_GRANTS)).toBe(false);
  });
});

describe("daily-log edit windows", () => {
  it("DRAFT is editable by anyone with write access", () => {
    for (const role of ALL_ROLES) {
      expect(canEditLogAtStatus("DRAFT", role, "write")).toBe(true);
    }
  });

  it("SUBMITTED is correctable by ADMIN/MANAGER only", () => {
    expect(ALL_ROLES.filter((r) => canEditLogAtStatus("SUBMITTED", r, "write"))).toEqual([
      "ADMIN",
      "MANAGER",
    ]);
  });

  it("APPROVED stays frozen except for admin/accounting amendments", () => {
    expect(ALL_ROLES.filter((r) => canEditLogAtStatus("APPROVED", r, "write"))).toEqual([
      "ADMIN",
      "OFFICE_STAFF",
    ]);
    // MANAGER approves but does not amend after the fact.
    expect(canEditLogAtStatus("APPROVED", "MANAGER", "write")).toBe(false);
    expect(canEditLogAtStatus("APPROVED", "CREW_LEAD", "write")).toBe(false);
  });

  it("read-only job access never edits, whatever the status or role", () => {
    for (const status of ["DRAFT", "SUBMITTED", "APPROVED"] as const) {
      for (const role of ALL_ROLES) {
        expect(canEditLogAtStatus(status, role, "read")).toBe(false);
        expect(canEditLogAtStatus(status, role, "none")).toBe(false);
      }
    }
  });

  it("amending is admin + accounting; reopening to DRAFT stays admin-only", () => {
    expect(ALL_ROLES.filter(canAmendApprovedLog)).toEqual(["ADMIN", "OFFICE_STAFF"]);
    expect(ALL_ROLES.filter(canReopenLog)).toEqual(["ADMIN"]);
  });
});

describe("serializePersonnel", () => {
  const record = {
    id: "p1",
    firstName: "Jane",
    lastName: "Doe",
    phone: "555",
    email: "j@x.com",
    address1: "1 Main",
    address2: null,
    city: "Miami",
    state: "FL",
    zipCode: "33101",
    emergencyContactName: "Bob",
    emergencyContactPhone: "556",
    emergencyContactRelation: "spouse",
    trade: "Drywall",
    title: "Foreman",
    hourlyRate: "35.00",
    employmentType: "W2",
    payType: "PIECEWORK",
    workDescription: "Hangs and finishes drywall",
    status: "ACTIVE",
    startDate: null,
    endDate: null,
    entityName: null,
    crewId: "c1",
    userId: null,
    notes: "n",
    isActive: true,
    ssnLast4: "6789",
    // Present exactly as a Prisma row would have them — the serializer must
    // strip these, not rely on them being absent.
    ssnCiphertext: "v1:aaa:bbb:ccc",
    ssnKeyVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    crew: { id: "c1", name: "Delta" },
  };

  it("returns null for roles without roster access", () => {
    expect(serializePersonnel(record, "SALES_REP")).toBeNull();
    expect(serializePersonnel(record, "MARKETING")).toBeNull();
  });

  it("gives CREW_LEAD roster fields only — no rate, contact, or SSN material", () => {
    const out = serializePersonnel(record, "CREW_LEAD")!;
    expect(out).toEqual({
      id: "p1",
      firstName: "Jane",
      lastName: "Doe",
      trade: "Drywall",
      title: "Foreman",
      employmentType: "W2",
      payType: "PIECEWORK",
      workDescription: "Hangs and finishes drywall",
      status: "ACTIVE",
      crewId: "c1",
      crew: { id: "c1", name: "Delta" },
      isActive: true,
    });
    expect(out).not.toHaveProperty("hourlyRate");
    expect(out).not.toHaveProperty("ssnLast4");
    expect(out).not.toHaveProperty("phone");
  });

  it("includes rate for cost-visible office roles", () => {
    const out = serializePersonnel(record, "ADMIN")! as Record<string, unknown>;
    expect(out.hourlyRate).toBe("35.00");
    expect(out.ssnLast4).toBe("6789");
    expect(out.hasSsn).toBe(true);
  });

  it("never emits ciphertext-shaped fields", () => {
    const out = serializePersonnel(record, "ADMIN")! as Record<string, unknown>;
    expect(out).not.toHaveProperty("ssnCiphertext");
    expect(out).not.toHaveProperty("ssnKeyVersion");
  });
});

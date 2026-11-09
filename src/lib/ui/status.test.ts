import { describe, expect, it } from "vitest";
import * as Enums from "@/generated/prisma/enums";
import { STATUS, statusItems, statusLabel, statusOf } from "./status";

// Each registry table and the Prisma enum it must cover in full.
const COVERS: Record<string, Record<string, string>> = {
  task: Enums.TaskStatus,
  priority: Enums.Priority,
  permit: Enums.PermitStatus,
  inspectionResult: Enums.PermitInspectionResult,
  inspectionType: Enums.PermitInspectionType,
  invoice: Enums.InvoiceStatus,
  changeOrder: Enums.ChangeOrderStatus,
  expense: Enums.ExpenseStatus,
  expenseType: Enums.JobExpenseType,
  estimate: Enums.EstimateStatus,
  payment: Enums.PaymentStatus,
  paymentRequest: Enums.LaborPaymentRequestStatus,
  commitment: Enums.CommitmentStatus,
  dailyLog: Enums.DailyLogStatus,
  contract: Enums.CustomerContractStatus,
  templateVersion: { ...Enums.ContractTemplateVersionStatus, ...Enums.WorkflowVersionStatus },
  roofrOrder: Enums.RoofrOrderStatus,
  route: Enums.DoorKnockRouteStatus,
  violationItem: Enums.CodeViolationItemStatus,
  hearing: Enums.CodeViolationHearingStatus,
  agencyInspection: Enums.CodeViolationInspectionStatus,
};

describe("status registry", () => {
  for (const [kind, values] of Object.entries(COVERS)) {
    it(`labels every ${kind} value, never with the raw code`, () => {
      const table = STATUS[kind as keyof typeof STATUS] as Record<string, { label: string }>;
      for (const v of Object.values(values)) {
        expect(table[v], `${kind}.${v} has no label`).toBeDefined();
        expect(table[v].label).not.toMatch(/^[A-Z_]{3,}$/);
      }
    });
  }
  it("an unknown value reads as words, not a code", () => {
    expect(statusOf("permit", "SOME_NEW_STATE")).toEqual({ label: "Some new state", tone: "neutral" });
    expect(statusLabel("permit", null)).toBe("—");
  });
  it("gives Select items", () => {
    expect(statusItems("invoice")).toEqual({ DRAFT: "Draft", SENT: "Sent", PAID: "Paid", VOID: "Void" });
  });
});

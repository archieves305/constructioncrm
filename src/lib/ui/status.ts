/**
 * One table for every status the app shows: a plain label and a tone per enum
 * value. <StatusBadge kind="permit" value={p.status} /> reads it, so no screen
 * prints a raw code ("BUILDING", "CLOSED_UNPAID") and no two screens colour
 * the same status differently. The tables live in @/lib/mobile-api/status so
 * the phone app shows the same words; this file checks them against each
 * Prisma enum, so a new enum value without a label fails the typecheck (and
 * status.test.ts checks the same at runtime).
 */
import type {
  ChangeOrderStatus,
  CodeViolationHearingStatus,
  CodeViolationInspectionStatus,
  CodeViolationItemStatus,
  CommitmentStatus,
  ContractTemplateVersionStatus,
  CustomerContractStatus,
  DailyLogStatus,
  DoorKnockRouteStatus,
  EstimateStatus,
  ExpenseStatus,
  InvoiceStatus,
  JobExpenseType,
  LaborPaymentRequestStatus,
  PaymentStatus,
  PermitInspectionResult,
  PermitInspectionType,
  PermitStatus,
  Priority,
  RoofrOrderStatus,
  TaskStatus,
  WorkflowVersionStatus,
} from "@/generated/prisma/enums";
import { STATUS as SHARED, type StatusEntry } from "@/lib/mobile-api/status";

type Table<E extends string> = Record<E, StatusEntry>;

/** Fails to compile when a Prisma enum gains a value the shared tables lack. */
const ENUM_CHECK: {
  task: Table<TaskStatus>;
  priority: Table<Priority>;
  permit: Table<PermitStatus>;
  inspectionResult: Table<PermitInspectionResult>;
  inspectionType: Table<PermitInspectionType>;
  invoice: Table<InvoiceStatus>;
  changeOrder: Table<ChangeOrderStatus>;
  expense: Table<ExpenseStatus>;
  expenseType: Table<JobExpenseType>;
  estimate: Table<EstimateStatus>;
  payment: Table<PaymentStatus>;
  paymentRequest: Table<LaborPaymentRequestStatus>;
  commitment: Table<CommitmentStatus>;
  dailyLog: Table<DailyLogStatus>;
  contract: Table<CustomerContractStatus>;
  templateVersion: Table<ContractTemplateVersionStatus & WorkflowVersionStatus>;
  roofrOrder: Table<RoofrOrderStatus>;
  route: Table<DoorKnockRouteStatus>;
  violationItem: Table<CodeViolationItemStatus>;
  hearing: Table<CodeViolationHearingStatus>;
  agencyInspection: Table<CodeViolationInspectionStatus>;
  agencyInspectionKind: Record<string, StatusEntry>;
} = SHARED;

export const STATUS = ENUM_CHECK;
export { statusOf, statusLabel, statusItems, statusTones, type StatusKind, type StatusEntry } from "@/lib/mobile-api/status";

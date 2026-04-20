import { toCsv } from "@/lib/csv";

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  MATERIAL: "Materials",
  LABOR: "Labor",
  EQUIPMENT: "Equipment",
  PERMIT_FEE: "Permit Fee",
  SUBCONTRACTOR: "Subcontractor",
  CHANGE_ORDER: "Change Order",
  OTHER: "Other",
};

export type QboExpenseRow = {
  expenseId: string;
  incurredDate: Date;
  amount: number;
  type: string;
  vendor: string | null;
  description: string | null;
  paidMethod: string | null;
  paidFrom: string | null;
  jobNumber: string;
  customerName: string;
  propertyAddress: string;
};

function formatDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function buildMemo(r: QboExpenseRow): string {
  const parts = [
    EXPENSE_TYPE_LABEL[r.type] ?? r.type,
    r.propertyAddress,
    r.description,
  ].filter((x): x is string => Boolean(x && x.trim()));
  return parts.join(" — ");
}

function buildCustomerJob(r: QboExpenseRow): string {
  return `${r.customerName}:${r.jobNumber}`;
}

export function toQboCsv(rows: QboExpenseRow[]): string {
  const records = rows.map((r) => ({
    Date: formatDate(r.incurredDate),
    Amount: r.amount.toFixed(2),
    Vendor: r.vendor ?? "",
    Account: "",
    Customer: buildCustomerJob(r),
    PaymentMethod: r.paidMethod ?? "",
    PaidFrom: r.paidFrom ?? "",
    Description: buildMemo(r),
  }));
  return toCsv(records, [
    { key: "Date", header: "Date" },
    { key: "Amount", header: "Amount" },
    { key: "Vendor", header: "Vendor" },
    { key: "Account", header: "Account" },
    { key: "Customer", header: "Customer" },
    { key: "PaymentMethod", header: "Payment Method" },
    { key: "PaidFrom", header: "Paid From" },
    { key: "Description", header: "Description" },
  ]);
}

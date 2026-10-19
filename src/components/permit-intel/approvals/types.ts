import type { JobLabelInput } from "@/lib/labels/job";
import type { Authority, Category, Flag } from "@/lib/permit-intel/approvals-plan";

/** What the product-approval routes answer, as the screens read them. Decimals arrive as strings. */
export type ApprovalRow = {
  id: string;
  authority: Authority;
  approvalNumber: string | null;
  revision: string | null;
  manufacturer: string | null;
  productName: string | null;
  category: Category;
  hvhzApproved: boolean | null;
  designPressurePos: string | null;
  designPressureNeg: string | null;
  expiresAt: string | null;
  readState: "EXTRACTING" | "REVIEW" | "VERIFIED" | "FAILED";
  isActive: boolean;
  fileName: string;
  _count: { permits: number; materials: number };
};

export type ApprovalDetail = Omit<ApprovalRow, "_count"> & {
  models: string[];
  nonHvhzApproved: boolean | null;
  impactRated: boolean | null;
  limitations: string | null;
  configurations: { deck: string | null; slope: string | null; underlayment: string | null; fastening: string | null; maxDesignPressure: string | null }[] | null;
  issuedAt: string | null;
  evidence: Record<string, { page: number; quote: string }> | null;
  readError: string | null;
  notes: string | null;
  sizeBytes: number;
  createdAt: string;
  verifiedAt: string | null;
  createdBy: { firstName: string; lastName: string };
  verifiedBy: { firstName: string; lastName: string } | null;
  aiCall: { costUsd: number; model: string } | null;
  materials: { item: { id: string; name: string; category: string } }[];
  permits: { id: string; usedAs: string; permit: { id: string; permitType: string | null; municipality: string; status: string; job: JobLabelInput & { id: string } } }[];
  catalog: { id: string; name: string; category: string }[];
  permissions: { canManage: boolean };
};

export type PermitProductRow = {
  id: string;
  permitId: string;
  approvalId: string;
  usedAs: string;
  requiredPressurePos: string | null;
  requiredPressureNeg: string | null;
  notes: string | null;
  label: string;
  inPackage: boolean;
  documentFile: { id: string; fileName: string } | null;
  flags: Flag[];
  approval: Pick<ApprovalRow, "id" | "authority" | "approvalNumber" | "revision" | "manufacturer" | "productName" | "category" | "hvhzApproved" | "designPressurePos" | "designPressureNeg" | "expiresAt" | "readState" | "isActive">;
};

export const READ_STATE: Record<ApprovalRow["readState"], { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  EXTRACTING: { label: "Reading…", tone: "info" },
  REVIEW: { label: "To check", tone: "warning" },
  VERIFIED: { label: "Checked", tone: "success" },
  FAILED: { label: "Not read", tone: "danger" },
};

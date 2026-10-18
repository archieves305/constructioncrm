import type { FillStatus, FillSummary, FillValue, InventoryField } from "@/lib/permit-intel/field-fill";

/** What the form-template and form-fill routes answer, as the screens read it. */
export type TemplateRow = {
  id: string;
  name: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  county: string | null;
  permitTypeKeys: string[];
  pageCount: number;
  fileName: string;
  mapState: "IDLE" | "MAPPING" | "FAILED";
  publishedAt: string | null;
  createdAt: string;
  fieldCount: number;
  jurisdiction: { id: string; name: string } | null;
  _count: { fields: number; fills: number };
};

export type FieldMapRow = { fieldName: string; dataKey: string | null; transform: string | null; aiSuggested: boolean; confidence: number | null; rationale: string | null };

export type TemplateDetail = Omit<TemplateRow, "fieldCount" | "_count"> & {
  jurisdictionId: string | null;
  notes: string | null;
  sha256: string;
  sizeBytes: number;
  formKind: string;
  mapError: string | null;
  fieldInventory: InventoryField[];
  fields: FieldMapRow[];
  createdBy: { firstName: string; lastName: string };
  publishedBy: { firstName: string; lastName: string } | null;
  _count: { fills: number };
};

export type FillRow = {
  id: string;
  permitId: string;
  templateId: string;
  status: "DRAFT" | "FINAL";
  overrides: Record<string, string>;
  values: FillValue[];
  summary: FillSummary;
  problems: string[];
  createdAt: string;
  finalizedAt: string | null;
  template: { id: string; name: string; version: number; status: string; pageCount: number };
  outputFile: { id: string; fileName: string; fileSize: number } | null;
  flattenedFile: { id: string; fileName: string; fileSize: number } | null;
  createdBy: { firstName: string; lastName: string };
  finalizedBy: { firstName: string; lastName: string } | null;
};

export type FillsData = {
  fills: FillRow[];
  available: { id: string; name: string; version: number; jurisdictionId: string | null; county: string | null; permitTypeKeys: string[]; pageCount: number }[];
  permissions: { canEdit: boolean; canFinalize: boolean };
};

export const FILL_STATUS: Record<FillStatus, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  FILLED: { label: "From records", tone: "success" },
  OVERRIDDEN: { label: "Typed", tone: "info" },
  MISSING: { label: "Missing", tone: "warning" },
  CONFLICT: { label: "Records disagree", tone: "danger" },
  UNMATCHED: { label: "Not an option", tone: "danger" },
  BLANK: { label: "Left for a person", tone: "neutral" },
  SIGN_BY_HAND: { label: "Sign by hand", tone: "neutral" },
};

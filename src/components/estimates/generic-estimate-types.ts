import type { EstimateCostType, EstimateUnitType } from "@/generated/prisma/enums";
import type { EstimateStatusValue } from "@/lib/estimates/estimate-status";

// Client-side form shapes for the generic estimate builder. Money/percent fields
// are strings in the form and converted to numbers on submit (same convention as
// the roofing panel).
export type FormItem = {
  uid: string;
  description: string;
  unitType: EstimateUnitType;
  quantity: string;
  /** The unit COST; the estimate's overhead and margin make the price. */
  unitPrice: string;
  costType: EstimateCostType;
  isOptional: boolean;
  notes: string;
};

export type FormSection = {
  uid: string;
  title: string;
  /** Set when the section was generated from a roof measurement. */
  roofMeasurementId?: string | null;
  items: FormItem[];
};

export type GenericFormState = {
  name: string;
  /** Carried through every save so an edit never resets SENT / ACCEPTED. */
  status: EstimateStatusValue;
  templateCategory: string;
  templateId: string | null;
  marginPercent: string;
  overheadPercent: string;
  discountEnabled: boolean;
  discountPercent: string;
  salesTaxPercent: string;
  validityDays: string;
  notes: string;
  exclusions: string;
  sections: FormSection[];
};

let counter = 0;
export function uid(): string {
  counter += 1;
  return `f${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyItem(unitType: EstimateUnitType = "EACH"): FormItem {
  return {
    uid: uid(),
    description: "",
    unitType,
    quantity: "",
    unitPrice: "",
    costType: unitType === "LABOR_HOUR" ? "LABOR" : "OTHER",
    isOptional: false,
    notes: "",
  };
}

export const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export const money = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

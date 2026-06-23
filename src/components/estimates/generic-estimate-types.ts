import type { EstimateUnitType } from "@/generated/prisma/enums";

// Client-side form shapes for the generic estimate builder. Money/percent fields
// are strings in the form and converted to numbers on submit (same convention as
// the roofing panel).
export type FormItem = {
  uid: string;
  description: string;
  unitType: EstimateUnitType;
  quantity: string;
  unitPrice: string;
  isOptional: boolean;
  notes: string;
};

export type FormSection = {
  uid: string;
  title: string;
  items: FormItem[];
};

export type GenericFormState = {
  name: string;
  templateCategory: string;
  templateId: string | null;
  marginPercent: string;
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

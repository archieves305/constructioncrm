import { env } from "@/lib/env";
import { buildiumRequest } from "./client";

type BuildiumBillLine = {
  GLAccountId: number;
  Amount: number;
  Memo?: string;
  AccountingEntity: {
    Id: number;
    AccountingEntityType: "Rental" | "Company";
    UnitId?: number;
  };
};

type BuildiumBillPayload = {
  VendorId: number;
  Date: string;
  DueDate?: string;
  ReferenceNumber?: string;
  Memo?: string;
  Lines: BuildiumBillLine[];
};

type BuildiumBill = {
  Id: number;
  VendorId: number;
  Date: string;
  ReferenceNumber?: string;
};

export type CreateBillInput = {
  vendorId: number;
  buildiumPropertyId: string;
  buildiumUnitId?: string | null;
  amount: number;
  incurredDate: Date;
  memo: string;
  referenceNumber?: string;
};

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function createRentalBill(
  input: CreateBillInput,
): Promise<BuildiumBill> {
  const glAccountId = Number(env.BUILDIUM_DEFAULT_GL_ACCOUNT_ID);
  if (!glAccountId) {
    throw new Error(
      "BUILDIUM_DEFAULT_GL_ACCOUNT_ID is not set. Pick an expense GL account in Buildium and add the ID to .env.",
    );
  }

  const line: BuildiumBillLine = {
    GLAccountId: glAccountId,
    Amount: Number(input.amount.toFixed(2)),
    Memo: input.memo.slice(0, 200),
    AccountingEntity: {
      Id: Number(input.buildiumPropertyId),
      AccountingEntityType: "Rental",
    },
  };
  if (input.buildiumUnitId) {
    line.AccountingEntity.UnitId = Number(input.buildiumUnitId);
  }

  const date = toYmd(input.incurredDate);
  const payload: BuildiumBillPayload = {
    VendorId: input.vendorId,
    Date: date,
    DueDate: date,
    Memo: input.memo.slice(0, 200),
    Lines: [line],
  };
  if (input.referenceNumber) {
    payload.ReferenceNumber = input.referenceNumber.slice(0, 30);
  }

  return await buildiumRequest<BuildiumBill>("/bills", {
    method: "POST",
    body: payload,
  });
}

import { env } from "@/lib/env";
import { buildiumRequest } from "./client";

type BuildiumCheckLine = {
  GLAccountId: number;
  Amount: number;
  Memo?: string;
  AccountingEntity: {
    Id: number;
    AccountingEntityType: "Rental" | "Company";
    UnitId?: number;
  };
};

type BuildiumCheckPayload = {
  EntryDate: string;
  Memo?: string;
  CheckNumber?: string;
  Payee: {
    Id: number;
    Type: "Vendor" | "Owner" | "Tenant";
  };
  Lines: BuildiumCheckLine[];
};

type BuildiumCheck = {
  Id: number;
  EntryDate?: string;
};

export type CreateCheckInput = {
  bankAccountId: number;
  vendorId: number;
  buildiumPropertyId: string;
  buildiumUnitId?: string | null;
  amount: number;
  incurredDate: Date;
  memo: string;
  checkNumber?: string;
};

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type BuildiumCheckListItem = {
  Id: number;
  EntryDate: string;
  TotalAmount: number;
  Memo?: string;
  Payee?: { Id?: number; Type?: string };
  Lines?: Array<{
    Amount: number;
    AccountingEntity?: { Id: number; AccountingEntityType?: string };
  }>;
};

export type PossibleDuplicate = {
  id: string;
  date: string;
  amount: number;
  payeeId: number | null;
  memo: string | null;
};

const DUPLICATE_WINDOW_DAYS = 2;

export async function findPossibleDuplicates(args: {
  bankAccountId: number;
  incurredDate: Date;
  amount: number;
  buildiumPropertyId: string;
  vendorId?: number;
}): Promise<PossibleDuplicate[]> {
  const from = new Date(args.incurredDate);
  from.setUTCDate(from.getUTCDate() - DUPLICATE_WINDOW_DAYS);
  const to = new Date(args.incurredDate);
  to.setUTCDate(to.getUTCDate() + DUPLICATE_WINDOW_DAYS);
  const checks = await buildiumRequest<BuildiumCheckListItem[]>(
    `/bankaccounts/${args.bankAccountId}/checks`,
    { query: { startdate: toYmd(from), enddate: toYmd(to), limit: 500 } },
  );
  if (!Array.isArray(checks)) return [];

  const propId = Number(args.buildiumPropertyId);
  const target = Number(args.amount.toFixed(2));

  return checks
    .filter((c) => {
      if (Number(c.TotalAmount?.toFixed?.(2) ?? c.TotalAmount) !== target) return false;
      const matchesProp = (c.Lines ?? []).some(
        (ln) => Number(ln.AccountingEntity?.Id) === propId,
      );
      if (!matchesProp) return false;
      if (args.vendorId && c.Payee?.Id && Number(c.Payee.Id) !== args.vendorId) {
        // different vendor — still flag (amount+date+property is the strong signal),
        // but we already passed the core check.
      }
      return true;
    })
    .map((c) => ({
      id: String(c.Id),
      date: c.EntryDate,
      amount: Number(c.TotalAmount),
      payeeId: c.Payee?.Id ?? null,
      memo: c.Memo ?? null,
    }));
}

export async function createBankCheck(
  input: CreateCheckInput,
): Promise<BuildiumCheck> {
  const glAccountId = Number(env.BUILDIUM_DEFAULT_GL_ACCOUNT_ID);
  if (!glAccountId) {
    throw new Error(
      "BUILDIUM_DEFAULT_GL_ACCOUNT_ID is not set. Pick an expense GL account and add the ID to .env.",
    );
  }

  const line: BuildiumCheckLine = {
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

  const payload: BuildiumCheckPayload = {
    EntryDate: toYmd(input.incurredDate),
    Memo: input.memo.slice(0, 200),
    Payee: { Id: input.vendorId, Type: "Vendor" },
    Lines: [line],
  };
  if (input.checkNumber) {
    payload.CheckNumber = input.checkNumber.slice(0, 30);
  }

  return await buildiumRequest<BuildiumCheck>(
    `/bankaccounts/${input.bankAccountId}/checks`,
    {
      method: "POST",
      body: payload,
    },
  );
}

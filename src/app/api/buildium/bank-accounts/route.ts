import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import {
  buildiumRequest,
  BuildiumError,
  BuildiumNotConfiguredError,
  isBuildiumConfigured,
} from "@/lib/integrations/buildium/client";
import { env } from "@/lib/env";

type BuildiumBankAccount = {
  Id: number;
  Name: string;
  BankAccountType?: string;
  AccountNumberLastFour?: string;
  IsActive?: boolean;
};

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (!isBuildiumConfigured()) {
    return NextResponse.json(
      { error: "Buildium is not configured." },
      { status: 503 },
    );
  }

  try {
    const accounts: BuildiumBankAccount[] = [];
    for (let offset = 0; offset < 2000; offset += 500) {
      const page = await buildiumRequest<BuildiumBankAccount[]>(
        "/bankaccounts",
        { query: { limit: 500, offset } },
      );
      if (!Array.isArray(page) || page.length === 0) break;
      accounts.push(...page);
      if (page.length < 500) break;
    }

    const defaultId = env.BUILDIUM_DEFAULT_BANK_ACCOUNT_ID
      ? Number(env.BUILDIUM_DEFAULT_BANK_ACCOUNT_ID)
      : null;

    return NextResponse.json({
      accounts: accounts
        .filter((a) => a.IsActive !== false)
        .map((a) => ({
          id: String(a.Id),
          name: a.Name,
          last4: a.AccountNumberLastFour ?? null,
          type: a.BankAccountType ?? null,
        })),
      defaultId: defaultId ? String(defaultId) : null,
    });
  } catch (e) {
    if (e instanceof BuildiumNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e instanceof BuildiumError) {
      return NextResponse.json(
        { error: e.message, buildiumStatus: e.status },
        { status: 502 },
      );
    }
    const message = e instanceof Error ? e.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

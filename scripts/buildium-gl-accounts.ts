import "dotenv/config";

const BASE = (process.env.BUILDIUM_BASE_URL || "https://api.buildium.com/v1").replace(/\/+$/, "");
const CLIENT_ID = process.env.BUILDIUM_CLIENT_ID || "";
const CLIENT_SECRET = process.env.BUILDIUM_CLIENT_SECRET || "";

async function req(path: string, query: Record<string, string | number | undefined> = {}) {
  const url = new URL(path.startsWith("/") ? path.slice(1) : path, BASE + "/");
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      "x-buildium-client-id": CLIENT_ID,
      "x-buildium-client-secret": CLIENT_SECRET,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, body: parsed };
}

type Account = {
  Id: number;
  Name: string;
  AccountNumber?: string;
  Type?: string;
  SubType?: string;
  IsActive?: boolean;
  IsDefaultGLAccount?: boolean;
};

async function main() {
  const all: Account[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const r = await req("/glaccounts", { limit: pageSize, offset });
    if (!r.ok) {
      console.log("error:", r.status, r.body);
      return;
    }
    const page = r.body as Account[];
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break;
  }

  console.log(`Total GL accounts: ${all.length}\n`);

  const expenseAccounts = all.filter(
    (a) => /expense/i.test(a.Type ?? "") || /expense/i.test(a.SubType ?? ""),
  );

  const candidates = expenseAccounts.filter((a) =>
    /repair|maintenance|turnover|make.?ready|contract|labor|renovation|construction|improv/i.test(
      a.Name,
    ),
  );

  console.log("=== Top suggestions (expense accounts matching repair/maintenance/turnover/etc.) ===");
  for (const a of candidates) {
    console.log(
      `  Id ${String(a.Id).padEnd(8)} ${(a.AccountNumber ?? "").padEnd(8)} ${a.Name}  [${a.Type ?? "?"}/${a.SubType ?? "?"}]${a.IsActive === false ? " (INACTIVE)" : ""}`,
    );
  }

  if (candidates.length === 0) {
    console.log("  (none matched keyword filter — showing all expense accounts below)\n");
  }

  console.log("\n=== All expense-type accounts ===");
  for (const a of expenseAccounts) {
    console.log(
      `  Id ${String(a.Id).padEnd(8)} ${(a.AccountNumber ?? "").padEnd(8)} ${a.Name}  [${a.Type ?? "?"}/${a.SubType ?? "?"}]${a.IsActive === false ? " (INACTIVE)" : ""}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

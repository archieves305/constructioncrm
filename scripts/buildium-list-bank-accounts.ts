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
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, body };
}

type Account = {
  Id: number;
  Name: string;
  BankAccountType?: string;
  AccountNumberLastFour?: string;
  IsActive?: boolean;
};

async function main() {
  const accounts: Account[] = [];
  for (let offset = 0; offset < 2000; offset += 500) {
    const r = await req("/bankaccounts", { limit: 500, offset });
    if (!r.ok) {
      console.log("error", r.status, r.body);
      return;
    }
    const page = r.body as Account[];
    if (!Array.isArray(page) || page.length === 0) break;
    accounts.push(...page);
    if (page.length < 500) break;
  }

  console.log(`Total bank accounts: ${accounts.length}\n`);
  for (const a of accounts) {
    console.log(
      `  Id ${String(a.Id).padEnd(8)} ${(a.BankAccountType ?? "?").padEnd(18)} ${a.Name}${a.AccountNumberLastFour ? ` (…${a.AccountNumberLastFour})` : ""}${a.IsActive === false ? " [INACTIVE]" : ""}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const BASE = (process.env.BUILDIUM_BASE_URL || "https://api.buildium.com/v1").replace(/\/+$/, "");
const CLIENT_ID = process.env.BUILDIUM_CLIENT_ID || "";
const CLIENT_SECRET = process.env.BUILDIUM_CLIENT_SECRET || "";
const VENDOR_NAME = process.env.BUILDIUM_VENDOR_NAME || "Knu Construction";

function assertCreds() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("BUILDIUM_CLIENT_ID / BUILDIUM_CLIENT_SECRET missing");
  }
}

async function req(path: string, query: Record<string, string | number | undefined> = {}) {
  assertCreds();
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

async function main() {
  console.log(`[smoke] base=${BASE}`);
  console.log(`[smoke] client_id=${CLIENT_ID.slice(0, 8)}…`);

  // 1. auth probe — list vendors page 1
  console.log("\n[1] GET /vendors?limit=1 (auth probe)");
  let r = await req("/vendors", { limit: 1 });
  console.log(`    status=${r.status}`);
  if (!r.ok) {
    console.log("    body:", r.body);
    console.log("→ auth failed. Stopping.");
    return;
  }
  console.log(`    ok — returned ${Array.isArray(r.body) ? r.body.length : "non-array"} row(s)`);

  // 2. vendor categories
  console.log("\n[2] GET /vendors/categories");
  r = await req("/vendors/categories", { limit: 50 });
  console.log(`    status=${r.status}`);
  if (r.ok && Array.isArray(r.body)) {
    console.log(`    categories: ${r.body.length}`);
    for (const c of r.body.slice(0, 10) as Array<{ Id: number; Name: string }>) {
      console.log(`      - ${c.Id}  ${c.Name}`);
    }
  } else {
    console.log("    body:", r.body);
  }

  // 3. search for existing Knu Construction vendor (read-only)
  console.log(`\n[3] GET /vendors?companyname=${VENDOR_NAME}`);
  r = await req("/vendors", { companyname: VENDOR_NAME, limit: 50 });
  console.log(`    status=${r.status}`);
  if (r.ok && Array.isArray(r.body)) {
    const hits = r.body as Array<{ Id: number; CompanyName?: string }>;
    console.log(`    matches: ${hits.length}`);
    for (const v of hits.slice(0, 5)) {
      console.log(`      - Id ${v.Id}  "${v.CompanyName ?? ""}"`);
    }
  } else {
    console.log("    body:", r.body);
  }

  // 4. list rentals
  console.log("\n[4] GET /rentals?limit=5");
  r = await req("/rentals", { limit: 5 });
  console.log(`    status=${r.status}`);
  if (r.ok && Array.isArray(r.body)) {
    type P = {
      Id: number;
      Name?: string;
      Address?: { AddressLine1?: string; City?: string; State?: string; PostalCode?: string };
    };
    console.log(`    properties returned: ${r.body.length}`);
    for (const p of r.body as P[]) {
      const a = p.Address ?? {};
      console.log(`      - Id ${p.Id}  "${p.Name ?? ""}"  ${a.AddressLine1 ?? ""}, ${a.City ?? ""} ${a.State ?? ""} ${a.PostalCode ?? ""}`);
    }
  } else {
    console.log("    body:", r.body);
  }

  // 5. pick a CRM lead address and see if we can find a candidate
  console.log("\n[5] match a CRM lead address against Buildium rentals (read-only)");
  const lead = await prisma.lead.findFirst({
    where: { propertyAddress1: { not: "" }, zipCode: { not: "" } },
    select: { fullName: true, propertyAddress1: true, city: true, state: true, zipCode: true },
    orderBy: { createdAt: "desc" },
  });
  if (!lead) {
    console.log("    no lead with address found — skipping");
  } else {
    console.log(`    lead: ${lead.fullName}`);
    console.log(`    addr: ${lead.propertyAddress1}, ${lead.city} ${lead.state} ${lead.zipCode}`);
    const { findPropertyCandidates } = await import("../src/lib/integrations/buildium/properties");
    try {
      const candidates = await findPropertyCandidates({
        address1: lead.propertyAddress1,
        city: lead.city,
        state: lead.state,
        zip: lead.zipCode,
      });
      console.log(`    candidates (score≥50): ${candidates.length}`);
      for (const c of candidates) {
        console.log(`      - ${c.score}%  Id ${c.propertyId}  ${c.address1}, ${c.city} ${c.state} ${c.zip}`);
      }
    } catch (e) {
      console.log("    lookup error:", (e as Error).message);
    }
  }

  console.log("\n[smoke] done.");
}

main()
  .catch((e) => {
    console.error("[smoke] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

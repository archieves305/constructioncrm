import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import {
  buildiumRequest,
  BuildiumError,
  BuildiumNotConfiguredError,
  isBuildiumConfigured,
} from "@/lib/integrations/buildium/client";

type BuildiumVendor = {
  Id: number;
  CompanyName?: string;
  FirstName?: string;
  LastName?: string;
  IsActive?: boolean;
};

type CachedVendors = {
  fetchedAt: number;
  list: { id: string; name: string; active: boolean }[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let vendorCache: CachedVendors | null = null;

async function getAllVendors(): Promise<CachedVendors["list"]> {
  if (vendorCache && Date.now() - vendorCache.fetchedAt < CACHE_TTL_MS) {
    return vendorCache.list;
  }
  const collected: BuildiumVendor[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const page = await buildiumRequest<BuildiumVendor[]>("/vendors", {
      query: { limit: 500, offset },
    });
    if (!Array.isArray(page) || page.length === 0) break;
    collected.push(...page);
    if (page.length < 500) break;
  }
  const list = collected.map((v) => ({
    id: String(v.Id),
    name:
      v.CompanyName?.trim() ||
      [v.FirstName, v.LastName].filter(Boolean).join(" ").trim() ||
      `Vendor ${v.Id}`,
    active: v.IsActive !== false,
  }));
  vendorCache = { fetchedAt: Date.now(), list };
  return list;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (!isBuildiumConfigured()) {
    return NextResponse.json(
      { error: "Buildium is not configured." },
      { status: 503 },
    );
  }

  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(50, Number(searchParams.get("limit") ?? 20));

  try {
    const all = await getAllVendors();
    const active = all.filter((v) => v.active);

    if (!q) {
      return NextResponse.json({
        vendors: active.slice(0, limit),
        total: active.length,
      });
    }

    const scored = active
      .map((v) => {
        const name = v.name.toLowerCase();
        let score = 0;
        if (name === q) score = 1000;
        else if (name.startsWith(q)) score = 500;
        else if (name.includes(q)) score = 100;
        return { v, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name))
      .slice(0, limit)
      .map((x) => x.v);

    return NextResponse.json({ vendors: scored, total: scored.length });
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

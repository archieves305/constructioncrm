"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BadgeCheck, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { READ_STATE, type ApprovalRow } from "@/components/permit-intel/approvals/types";
import { useSession } from "@/lib/auth/session-client";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { canManageApprovals } from "@/lib/permit-intel/access";
import { AUTHORITY_LABEL, CATEGORIES, CATEGORY_LABEL } from "@/lib/permit-intel/approvals-plan";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";

const ALL = "";
const CATEGORY_ITEMS = [{ value: ALL, label: "Every category" }, ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))];

const psf = (pos: string | null, neg: string | null) => [pos ? `+${Number(pos)}` : null, neg ? `${Number(neg)}` : null].filter(Boolean).join(" / ");

/**
 * The product approvals KNU builds with — Florida Product Approvals and
 * Miami-Dade NOAs — each read from its document and checked by a person,
 * linked to the permits that use them.
 */
export default function ProductApprovalsPage() {
  const url = useSearchParamState();
  const router = useRouter();
  const q = url.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  const category = url.get("category") ?? ALL;
  const hvhz = url.get("hvhz") === "1";
  const expiring = url.get("expiring") === "1";
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => typed.trim() !== q && url.set("q", typed.trim() || null), 300);
    return () => clearTimeout(t);
  }, [typed, q, url]);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (hvhz) params.set("hvhz", "1");
  if (expiring) params.set("expiring", "1");
  const { data, isLoading, error } = useQuery({ queryKey: ["product-approvals", params.toString()], queryFn: () => fetchJson<ApprovalRow[]>(`/api/product-approvals?${params}`), retry: retryServerErrors, placeholderData: (p) => p });
  const { data: session } = useSession();
  const canManage = canManageApprovals(session?.user?.role);

  const upload = async (list: FileList | null) => {
    const f = list?.[0];
    if (input.current) input.current.value = "";
    if (!f) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const a = await fetchJson<{ id: string }>("/api/product-approvals", { method: "POST", body: form });
      router.push(`/permits/products/${a.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Product approvals"
        description="Florida Product Approvals and Miami-Dade NOAs, read from their documents and checked by a person."
        breadcrumb={[{ label: "Permits", href: "/permits" }, { label: "Product approvals" }]}
        actions={
          canManage ? (
            <>
              <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files)} />
              <Button variant="brand" disabled={uploading} onClick={() => input.current?.click()}>
                <Upload className="mr-2 size-4" /> {uploading ? "Uploading…" : "Add an approval"}
              </Button>
            </>
          ) : null
        }
      />
      <Card className="min-w-0">
        <CardContent className="space-y-3 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Number, manufacturer, product or model" aria-label="Search approvals" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Select items={CATEGORY_ITEMS} value={category} onValueChange={(v: string | null) => url.set("category", v || null)}>
              <SelectTrigger className="h-9 w-[200px]" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ITEMS.map((c) => (
                  <SelectItem key={c.value || "all"} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={hvhz} onCheckedChange={(v) => url.set("hvhz", v === true ? "1" : null)} /> HVHZ approved
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={expiring} onCheckedChange={(v) => url.set("expiring", v === true ? "1" : null)} /> Expiring within 60 days
            </label>
          </div>
        </CardContent>
      </Card>
      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <Callout tone="danger" title="The approvals did not load">{(error as Error).message}</Callout>
      ) : !data?.length ? (
        <EmptyState icon={BadgeCheck} title={q || category || hvhz || expiring ? "Nothing matches" : "No approvals yet"} description="Add the NOA or Florida Product Approval for each product KNU installs — underlayments, roof coverings, windows, doors. The AI reads the number, dates, HVHZ status and design pressures; a person checks them." />
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {data.map((a) => (
            <li key={a.id} className={cn(!a.isActive && "opacity-60")}>
              <Link href={`/permits/products/${a.id}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-muted/50">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="truncate text-sm font-medium">{a.productName ?? a.fileName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.manufacturer ?? "Manufacturer not read"} · {AUTHORITY_LABEL[a.authority]} {a.approvalNumber ?? ""}
                    {a.revision ? ` ${a.revision}` : ""} · {CATEGORY_LABEL[a.category]}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {a.hvhzApproved && <span className={cn("rounded-full px-2 py-0.5 font-medium", toneClasses("info").pill)}>HVHZ</span>}
                  {psf(a.designPressurePos, a.designPressureNeg) && <span className="text-muted-foreground">{psf(a.designPressurePos, a.designPressureNeg)} psf</span>}
                  {a.expiresAt && <span className={cn(new Date(a.expiresAt) < new Date() ? "text-tone-danger-fg" : "text-muted-foreground")}>expires {format(new Date(a.expiresAt), "MMM d, yyyy")}</span>}
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", toneClasses(READ_STATE[a.readState].tone).pill)}>{READ_STATE[a.readState].label}</span>
                  {a._count.permits > 0 && <span className="text-muted-foreground">{a._count.permits} permit{a._count.permits === 1 ? "" : "s"}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

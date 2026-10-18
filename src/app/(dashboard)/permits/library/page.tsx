"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { FileText, Lock, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { FilePreviewDialog } from "@/components/files/file-preview";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJurisdictions, usePermitTypes } from "@/components/permit-intel/use-permit-intel";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { formatFileSize } from "@/lib/files/limits";
import { jobLabel, type JobLabelInput } from "@/lib/labels/job";
import { PERMIT_DOC_TYPES, permitDocLabel } from "@/lib/permit-intel/doc-types";
import { cn } from "@/lib/utils";

type LibraryFile = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
  permitDocType: string | null;
  missing: boolean;
  permitLock: "submitted" | "issued" | null;
  job: (JobLabelInput & { id: string }) | null;
  permit: { id: string; permitType: string | null; municipality: string; status: string; permitNumber: string | null; applicationNumber: string | null; jurisdiction: { id: string; name: string } | null };
  snippet: string | null;
};
type LibraryResult = { files: LibraryFile[]; total: number; searched: boolean };

const ALL = "";
const DOC_ITEMS = [{ value: ALL, label: "Every document type" }, { value: "unclassified", label: "Unclassified" }, ...PERMIT_DOC_TYPES.map((t) => ({ value: t.key, label: t.label }))];

/** "[[word]]" from the database's highlighter → bold, everything else as text. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[.*?\]\])/g);
  return (
    <p className="line-clamp-2 text-xs text-muted-foreground">
      {parts.map((p, i) =>
        p.startsWith("[[") && p.endsWith("]]") ? (
          <mark key={i} className="rounded-sm bg-tone-warning-soft px-0.5 text-foreground">
            {p.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

function FilterSelect({ id, label, value, items, onChange }: { id: string; label: string; value: string; items: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select items={items} value={value} onValueChange={(v: string | null) => onChange(v ?? ALL)}>
        <SelectTrigger id={id} className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value || "all"} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Every permit document across the jobs you work on: by jurisdiction, permit
 * type and document type, and searched in the text of the PDFs themselves —
 * "which approvals did Palm Beach ask for on a re-roof", "the NOA for that
 * underlayment".
 */
export default function PermitLibraryPage() {
  const url = useSearchParamState();
  const q = url.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  const filters = { q, jurisdictionId: url.get("jurisdiction") ?? ALL, permitTypeKey: url.get("type") ?? ALL, docType: url.get("doc") ?? ALL, submitted: url.get("submitted") === "1" };
  const { data: jurisdictions = [] } = useJurisdictions(true);
  const { data: types = [] } = usePermitTypes();
  const [preview, setPreview] = useState<number | null>(null);

  // the search follows the typing, a moment after it stops
  useEffect(() => {
    const t = setTimeout(() => {
      if (typed.trim() !== q) url.set("q", typed.trim() || null);
    }, 350);
    return () => clearTimeout(t);
  }, [typed, q, url]);

  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.jurisdictionId) params.set("jurisdictionId", filters.jurisdictionId);
  if (filters.permitTypeKey) params.set("permitTypeKey", filters.permitTypeKey);
  if (filters.docType) params.set("docType", filters.docType);
  if (filters.submitted) params.set("submitted", "1");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["permit-library", params.toString()],
    queryFn: () => fetchJson<LibraryResult>(`/api/permits/library?${params}`),
    retry: retryServerErrors,
    placeholderData: (prev) => prev,
  });

  const jurisdictionItems = [{ value: ALL, label: "Every jurisdiction" }, ...jurisdictions.map((j) => ({ value: j.id, label: j.name }))];
  const typeItems = [{ value: ALL, label: "Every permit type" }, ...types.map((t) => ({ value: t.key, label: t.name }))];
  const files = data?.files ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Permit Library" description="Every permit document on the jobs you work on, searchable by what the PDFs say." breadcrumb={[{ label: "Permits", href: "/permits" }, { label: "Library" }]} />
      <Card className="min-w-0">
        <CardContent className="space-y-3 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder='Search the documents — e.g. "wind load" underlayment, or NOA 21-0412' aria-label="Search the documents" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FilterSelect id="lib-j" label="Jurisdiction" value={filters.jurisdictionId} items={jurisdictionItems} onChange={(v) => url.set("jurisdiction", v || null)} />
            <FilterSelect id="lib-t" label="Permit type" value={filters.permitTypeKey} items={typeItems} onChange={(v) => url.set("type", v || null)} />
            <FilterSelect id="lib-d" label="Document type" value={filters.docType} items={DOC_ITEMS} onChange={(v) => url.set("doc", v || null)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={filters.submitted} onCheckedChange={(v) => url.set("submitted", v === true ? "1" : null)} />
            Only documents sent in a submitted package
          </label>
        </CardContent>
      </Card>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <Callout tone="danger" title="The library did not load" action={<button className="underline" onClick={() => refetch()}>Try again</button>}>
          {(error as Error).message}
        </Callout>
      ) : files.length === 0 ? (
        <EmptyState icon={FileText} title={filters.q ? "Nothing matches" : "No permit documents yet"} description={filters.q ? "Try fewer or other words. Scanned documents have no text to search; find them by type." : "Documents uploaded on a permit appear here."} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {data!.total} document{data!.total === 1 ? "" : "s"}
            {data!.searched ? " matching, best first" : ", newest first"}
            {data!.total > files.length ? ` — showing ${files.length}` : ""}
          </p>
          <ul className="divide-y rounded-md border bg-card">
            {files.map((f, i) => (
              <li key={f.id} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5">
                <button type="button" className="min-w-0 flex-1 basis-64 space-y-0.5 text-left" onClick={() => setPreview(i)}>
                  <span className={cn("block truncate text-sm font-medium", f.missing && "text-tone-danger-fg")}>{f.fileName}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {permitDocLabel(f.permitDocType)} · {formatFileSize(f.fileSize)} · {format(new Date(f.createdAt), "MMM d, yyyy")}
                    {f.missing && " · missing from the store"}
                  </span>
                  {f.snippet && <Snippet text={f.snippet} />}
                </button>
                <div className="min-w-0 flex-1 basis-56 text-xs sm:flex-none">
                  <Link href={`/permits/${f.permit.id}?tab=documents`} className="block truncate font-medium text-primary hover:underline">
                    {f.permit.permitType ?? "Permit"} — {f.permit.jurisdiction?.name ?? f.permit.municipality}
                  </Link>
                  {f.job && <span className="block truncate text-muted-foreground">{jobLabel(f.job, { customer: false, trade: false }).primary}</span>}
                  {f.permitLock && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Lock className="size-3" /> {f.permitLock === "submitted" ? "Submitted" : "Issued"}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <FilePreviewDialog files={files} index={preview} onIndexChange={setPreview} />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Check, MapPin, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";

export type PickedLead = { id: string; fullName: string; propertyAddress1: string; city: string; state: string; zipCode: string; county: string | null; primaryPhone?: string | null };

/** Find the property by address or owner; the lead is the property record. Or create one and come back. */
export function LeadPicker({ value, onChange, returnTo }: { value: PickedLead | null; onChange: (lead: PickedLead) => void; returnTo: string }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<{ data: PickedLead[] }>({
    queryKey: ["leads", "picker", q],
    queryFn: () => fetchJson(`/api/leads?includeClosed=true&pageSize=20&search=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    retry: retryServerErrors,
    staleTime: 30_000,
  });
  const rows = data?.data ?? [];
  return (
    <div className="space-y-3">
      {value && (
        <div className="flex items-start gap-2 rounded-md border border-brand bg-brand/5 p-3 text-sm">
          <Check className="mt-0.5 size-4 text-brand-fg" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{value.fullName}</div>
            <div className="text-muted-foreground">
              {value.propertyAddress1}, {value.city} {value.state} {value.zipCode}
              {value.county ? ` · ${value.county} County` : ""}
            </div>
          </div>
          <Link href={`/leads/${value.id}`} target="_blank" className="text-xs underline">
            Open
          </Link>
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by address, owner name, phone or email…" autoFocus={!value} />
      </div>
      {q.trim().length >= 2 &&
        (isLoading ? (
          <Skeleton className="h-24" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No property matches. Create the lead below; you will come straight back here.</p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {rows.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => onChange(l)} className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50", value?.id === l.id && "bg-brand/5")}>
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {l.propertyAddress1}, {l.city}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {l.fullName}
                      {l.county ? ` · ${l.county} County` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      <Link href={`/leads/new?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex items-center gap-1 text-sm underline">
        <Plus className="size-3.5" /> Create a new lead for this property
      </Link>
    </div>
  );
}

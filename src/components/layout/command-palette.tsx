"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Clock, Gavel, MapPin, UserRound } from "lucide-react";
import type { RoleName } from "@/generated/prisma/client";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { SearchHit } from "@/lib/search/format";
import { useDebouncedValue } from "@/components/shared/use-debounced-value";
import { useRecentlyViewed } from "@/components/shared/use-recently-viewed";
import { navSections } from "./sidebar";

const ICONS = { job: Briefcase, lead: UserRound, case: Gavel, prospect: MapPin } as const;
const GROUPS: { type: SearchHit["type"]; heading: string }[] = [
  { type: "job", heading: "Jobs" },
  { type: "lead", heading: "Leads" },
  { type: "case", heading: "Code violation cases" },
  { type: "prospect", heading: "Prospects" },
];

/**
 * ⌘K. Empty: where you were, and every page you can open. Typing: jobs,
 * leads, cases and prospects by address, customer, number or phone, scoped
 * like the lists. Enter opens the highlighted row.
 */
export function CommandPalette({ open, onOpenChange, role }: { open: boolean; onOpenChange: (o: boolean) => void; role: RoleName }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q.trim(), 200);
  const { items: recent } = useRecentlyViewed();

  // Reset the box on close so the next ⌘K starts clean (no effect: the
  // close is the event).
  function handleOpenChange(o: boolean) {
    if (!o) setQ("");
    onOpenChange(o);
  }

  const { data, isFetching } = useQuery<{ hits: SearchHit[] }>({
    queryKey: ["search", dq],
    queryFn: () => fetchJson(`/api/search?q=${encodeURIComponent(dq)}`),
    enabled: open && dq.length >= 2,
    retry: retryServerErrors,
    staleTime: 30_000,
  });
  const hits = data?.hits ?? [];

  const pages = useMemo(
    () =>
      navSections
        .filter((s) => !s.roles || s.roles.includes(role))
        .flatMap((s) => s.items.filter((i) => !i.roles || i.roles.includes(role)).map((i) => ({ ...i, group: s.label }))),
    [role],
  );

  function go(href: string) {
    handleOpenChange(false);
    router.push(href);
  }

  const searching = dq.length >= 2;
  // cmdk's own filter is off (the server does the record search); pages are
  // matched by name here so "hearings" still jumps to Hearings.
  const needle = q.trim().toLowerCase();
  const pageHits = useMemo(
    () => (needle ? pages.filter((p) => p.label.toLowerCase().includes(needle) || (p.group ?? "").toLowerCase().includes(needle)) : pages),
    [pages, needle],
  );
  // Rows mount after cmdk's own "select the first item" pass (debounce, then
  // the fetch), so the highlighted row is controlled: whatever is first in
  // render order unless the person moved. Enter then always opens something.
  const [selected, setSelected] = useState("");
  const ordered = searching
    ? [...GROUPS.flatMap(({ type }) => hits.filter((h) => h.type === type).map((h) => `${h.type}:${h.id}`)), ...pageHits.map((p) => `page:${p.href}`)]
    : [...(needle ? [] : recent.map((r) => `recent:${r.href}`)), ...pageHits.map((p) => `page:${p.href}`)];
  const current = ordered.includes(selected) ? selected : (ordered[0] ?? "");
  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} title="Search" description="Find a job, lead, case or page" className="sm:max-w-xl">
      <Command shouldFilter={false} value={current} onValueChange={setSelected}>
        <CommandInput value={q} onValueChange={setQ} placeholder="Search by address, customer, job #, phone — or a page…" />
        <CommandList className="max-h-[60vh]">
          {searching ? (
            <>
              {hits.length === 0 && pageHits.length === 0 && <CommandEmpty>{isFetching ? "Searching…" : "Nothing matches."}</CommandEmpty>}
              {GROUPS.map(({ type, heading }) => {
                const rows = hits.filter((h) => h.type === type);
                if (rows.length === 0) return null;
                const Icon = ICONS[type];
                return (
                  <CommandGroup key={type} heading={heading}>
                    {rows.map((h) => (
                      <CommandItem key={`${h.type}:${h.id}`} value={`${h.type}:${h.id}`} onSelect={() => go(h.href)} className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{h.primary}</span>
                          {h.secondary && <span className="block truncate text-xs text-muted-foreground">{h.secondary}</span>}
                        </span>
                        {h.code && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{h.code}</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
              {pageHits.length > 0 && (
                <CommandGroup heading="Go to">
                  {pageHits.map((p) => {
                    const Icon = p.icon;
                    return (
                      <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)} className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-sm">{p.label}</span>
                        {p.group && <span className="shrink-0 text-xs text-muted-foreground">{p.group}</span>}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </>
          ) : (
            <>
              {pageHits.length === 0 && <CommandEmpty>No page matches.</CommandEmpty>}
              {recent.length > 0 && !needle && (
                <CommandGroup heading="Recently viewed">
                  {recent.map((r) => {
                    const Icon = ICONS[r.type];
                    return (
                      <CommandItem key={r.href} value={`recent:${r.href}`} onSelect={() => go(r.href)} className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{r.primary}</span>
                          {r.secondary && <span className="block truncate text-xs text-muted-foreground">{r.secondary}</span>}
                        </span>
                        {r.code && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.code}</span>}
                        <Clock className="size-3.5 shrink-0 text-gray-300" />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              <CommandGroup heading="Go to">
                {pageHits.map((p) => {
                  const Icon = p.icon;
                  return (
                    <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)} className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-sm">{p.label}</span>
                      {p.group && <span className="shrink-0 text-xs text-muted-foreground">{p.group}</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";

type Report = {
  configured: boolean;
  model: string;
  caps: { maxSubject: number; maxMonth: number };
  month: string;
  monthSpentUsd: number;
  months: { month: string; calls: number; failed: number; costUsd: number }[];
  byPurpose: { purpose: string; calls: number; failed: number; costUsd: number }[];
  recentFailures: { id: string; createdAt: string; subjectType: string; subjectId: string; purpose: string; model: string; error: string | null }[];
};

// a single cheap call costs fractions of a cent: shown to the hundredth of a cent until it reaches one
const usd = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const monthLabel = (k: string) => format(new Date(`${k}-15T12:00:00`), "MMM yyyy");

/**
 * What the shared AI layer has cost. Every call — whichever feature made it,
 * whether it worked or not — is one `AiCall` row; this page only reads them.
 */
export default function AiUsagePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "ai-usage"],
    queryFn: () => fetchJson<Report>("/api/admin/ai-usage"),
    retry: retryServerErrors,
  });

  const total = data?.months.reduce((n, m) => n + m.calls, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="AI Usage" description="What the AI features have cost, by month and by purpose, and the limits that stop spending." />
      {error ? (
        <Callout tone="danger" title="Couldn't load AI usage">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {!data.configured && (
            <Callout tone="warning" title="AI is not set up on this server">
              Set ANTHROPIC_API_KEY in the server environment. Until then every AI action says so and the manual paths keep working.
            </Callout>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="min-w-0">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">This month</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">{usd(data.monthSpentUsd)}</p>
                <p className="text-xs text-muted-foreground">of the ${data.caps.maxMonth.toFixed(0)} monthly limit</p>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Allowance per record</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">${data.caps.maxSubject.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">one permit, notice or document</p>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Default model</CardTitle></CardHeader>
              <CardContent>
                <p className="truncate font-mono text-base">{data.model}</p>
                <p className="text-xs text-muted-foreground">a feature may use a cheaper one</p>
              </CardContent>
            </Card>
          </div>

          {total === 0 ? (
            <EmptyState icon={Sparkles} title="No AI calls yet" description="Calls appear here as soon as an AI feature is used." />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="min-w-0">
                <CardHeader><CardTitle className="text-base">By month</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Failed</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.months.map((m) => (
                        <TableRow key={m.month}>
                          <TableCell>{monthLabel(m.month)}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.calls}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.failed}</TableCell>
                          <TableCell className="text-right tabular-nums">{usd(m.costUsd)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card className="min-w-0">
                <CardHeader><CardTitle className="text-base">This month by purpose</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  {data.byPurpose.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No calls this month.</p>
                  ) : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Purpose</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Failed</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {data.byPurpose.map((p) => (
                          <TableRow key={p.purpose}>
                            <TableCell className="font-mono text-xs">{p.purpose}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.calls}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.failed}</TableCell>
                            <TableCell className="text-right tabular-nums">{usd(p.costUsd)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {data.recentFailures.length > 0 && (
            <Card className="min-w-0">
              <CardHeader><CardTitle className="text-base">Latest failures</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Purpose</TableHead><TableHead>Record</TableHead><TableHead>What happened</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.recentFailures.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="whitespace-nowrap">{format(new Date(f.createdAt), "MMM d, h:mm a")}</TableCell>
                        <TableCell className="font-mono text-xs">{f.purpose}</TableCell>
                        <TableCell className="font-mono text-xs">{f.subjectType}:{f.subjectId.slice(-8)}</TableCell>
                        <TableCell className="max-w-[420px] truncate text-sm" title={f.error ?? undefined}>{f.error ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

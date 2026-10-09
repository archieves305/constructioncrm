"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ruler } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TRADE_LABEL, type TradeName } from "@/lib/takeoff/metrics";
import { useCreateTakeoff, useTakeoffs } from "./use-takeoff";

/**
 * One card per trade on a plan set: the takeoff that exists (with its count
 * and what is left to review) or the button that starts one. Analysis (M3)
 * will sit on these cards too.
 */
export function TradeCards({ leadId, planSetId, canEdit }: { leadId: string; planSetId: string; canEdit: boolean }) {
  const router = useRouter();
  const takeoffs = useTakeoffs(leadId);
  const create = useCreateTakeoff(leadId);
  const trades: TradeName[] = ["ROOFING", "PLUMBING"];
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="trade-cards">
      {trades.map((trade) => {
        const t = takeoffs.data?.find((x) => x.planSet.id === planSetId && x.trade === trade && x.status !== "SUPERSEDED");
        const toReview = t ? (t.byStatus.AI_GENERATED ?? 0) + (t.byStatus.NEEDS_CLARIFICATION ?? 0) : 0;
        return (
          <Card key={trade}>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Ruler className="h-4 w-4 text-muted-foreground" /> {TRADE_LABEL[trade]}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {t ? (
                <>
                  <p><span className="font-mono text-muted-foreground">{t.number}</span> · {t.measurementCount} measurement{t.measurementCount === 1 ? "" : "s"} on {t.sheets.length} sheet{t.sheets.length === 1 ? "" : "s"}</p>
                  <p className="text-xs text-muted-foreground">{toReview ? `${toReview} to review` : t.measurementCount ? "Nothing waiting for review" : "Nothing measured yet — open it and draw, or run the analysis once it ships"}{t.stale ? " · the plan set has newer documents" : ""}</p>
                  <Link href={`/takeoff/${t.id}`} className={buttonVariants({ size: "sm" })}>Open takeoff</Link>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">No {TRADE_LABEL[trade].toLowerCase()} takeoff on this plan set yet.</p>
                  {canEdit && <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate({ planSetId, trade }, { onSuccess: (x) => router.push(`/takeoff/${x.id}`) })}>Start {TRADE_LABEL[trade].toLowerCase()} takeoff</Button>}
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

"use client";

import { BadgeDollarSign, CalendarClock, PhoneOutgoing } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { CollapsibleSection } from "@/components/shared/collapsible-section";
import { canAdminPartners } from "@/lib/partners/access";
import { useSession } from "@/lib/auth/session-client";
import { useBdSummary } from "./use-partners";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The dashboard's Business Development strip, for ADMIN / MANAGER: what is in play and what is slipping. Foldable; the fold is remembered. */
export function BusinessDevelopmentStrip() {
  const { data: session } = useSession();
  const allowed = canAdminPartners(session?.user.role);
  const q = useBdSummary(allowed);
  if (!allowed || !q.data) return null;
  const d = q.data;
  return (
    <CollapsibleSection id="dashboard-business-development" title="Business development" summary={`${d.openBids} open bid${d.openBids === 1 ? "" : "s"}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KpiCard compact title="Open bid value" value={usd(d.openBidValue)} icon={BadgeDollarSign} description={`${d.openBids} open bid${d.openBids === 1 ? "" : "s"}`} href="/partners/bids" />
        <KpiCard compact title="Bids due this week" value={d.bidsDueThisWeek} icon={CalendarClock} tone={d.bidsDueThisWeek ? "warning" : undefined} description="Not yet submitted" href="/attention/bids-due?scope=all" />
        <KpiCard compact title="Partner follow-ups overdue" value={d.overdueFollowUps} icon={PhoneOutgoing} tone={d.overdueFollowUps ? "danger" : undefined} description="GC accounts gone quiet" href="/attention/partner-follow-ups?scope=all" />
      </div>
    </CollapsibleSection>
  );
}

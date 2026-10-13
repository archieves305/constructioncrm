"use client";

import { BadgeDollarSign, CalendarClock, PhoneOutgoing } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { canAdminPartners } from "@/lib/partners/access";
import { useSession } from "@/lib/auth/session-client";
import { useBdSummary } from "./use-partners";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The dashboard's Business Development strip, for ADMIN / MANAGER: what is in play and what is slipping. */
export function BusinessDevelopmentStrip() {
  const { data: session } = useSession();
  const allowed = canAdminPartners(session?.user.role);
  const q = useBdSummary(allowed);
  if (!allowed || !q.data) return null;
  const d = q.data;
  return (
    <section aria-label="Business development" className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Business development</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard title="Open bid value" value={usd(d.openBidValue)} icon={BadgeDollarSign} description={`${d.openBids} open bid${d.openBids === 1 ? "" : "s"}`} href="/partners/bids" />
        <KpiCard title="Bids due this week" value={d.bidsDueThisWeek} icon={CalendarClock} tone={d.bidsDueThisWeek ? "warning" : undefined} description="Not yet submitted" href="/attention/bids-due?scope=all" />
        <KpiCard title="Partner follow-ups overdue" value={d.overdueFollowUps} icon={PhoneOutgoing} tone={d.overdueFollowUps ? "danger" : undefined} description="GC accounts gone quiet" href="/attention/partner-follow-ups?scope=all" />
      </div>
    </section>
  );
}

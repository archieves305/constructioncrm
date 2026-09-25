"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { useSession } from "@/lib/auth/session-client";
import { canCreateCase } from "@/lib/violations/access";
import { IntakeForm } from "@/components/violations/intake/intake-form";

export default function NewViolationCasePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Body />
    </Suspense>
  );
}

function Body() {
  const sp = useSearchParams();
  const { data: session } = useSession();
  if (session && !canCreateCase(session.user.role)) {
    return (
      <Callout tone="warning" title="Cases are opened by the office">
        Ask a manager or office staff to open the case. <Link href="/violations/list" className="underline">Back to cases</Link>
      </Callout>
    );
  }
  return <IntakeForm prefill={{ leadId: sp.get("leadId"), jobId: sp.get("jobId") }} returnedLeadId={sp.get("createdLeadId")} />;
}

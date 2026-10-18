"use client";

import { use } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { EntityHeader } from "@/components/shared/entity-header";
import { Callout } from "@/components/shared/callout";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermitEditor } from "@/components/permits/permit-editor";
import { PermitInspections } from "@/components/permits/permit-inspections";
import { expiryNotice, formatDay, PERMIT_STATUS_LABEL, PERMIT_STATUS_TONE, type AssignableUser } from "@/components/permits/shared";
import { EntityTaskPanel } from "@/components/tasks/entity-task-panel";
import { PermitCorrections } from "@/components/permit-intel/corrections/permit-corrections";
import { PermitCycles } from "@/components/permit-intel/permit-cycles";
import { PermitDocuments } from "@/components/permit-intel/permit-documents";
import { PermitParties } from "@/components/permit-intel/permit-parties";
import { OUTCOME_LABEL, type HistoryRow, type PermitDetail } from "@/components/permit-intel/types";
import { permitIntelKeys, useInvalidatePermit, usePermitDetail } from "@/components/permit-intel/use-permit-intel";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { jobLabel } from "@/lib/labels/job";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";

const TABS = ["overview", "documents", "parties", "submissions", "corrections", "tasks", "inspections", "history"] as const;
type Tab = (typeof TABS)[number];

/**
 * One permit's whole record: its status and numbers, the documents against
 * what the jurisdiction asks for, who is on the application, each
 * submission and the department's answer, its tasks, inspections and history.
 */
export default function PermitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const url = useSearchParamState();
  const tab: Tab = (TABS as readonly string[]).includes(url.get("tab") ?? "") ? (url.get("tab") as Tab) : "overview";
  const { data, isLoading, error } = usePermitDetail(id);
  const invalidate = useInvalidatePermit(id, data?.permit.jobId);
  const { data: users = [] } = useQuery<AssignableUser[]>({ queryKey: ["assignable-users"], queryFn: () => fetchJson("/api/users/assignable") });

  if (isLoading) return <ListSkeleton rows={6} />;
  if (error || !data) {
    const notFound = error instanceof HttpError && error.status === 404;
    return (
      <Callout tone={notFound ? "info" : "danger"} title={notFound ? "Permit not found" : "The permit did not load"}>
        {notFound ? "It may have been removed, or it is on a job you do not work on." : ((error as Error | null)?.message ?? "Try again in a moment.")}
      </Callout>
    );
  }

  const { permit, permissions } = data;
  const job = jobLabel(permit.job, { customer: true, trade: false });
  const notice = expiryNotice(permit);
  const title = `${permit.permitType ?? "Permit"}${permit.permitNumber ? ` #${permit.permitNumber}` : ""}`;

  return (
    <div>
      <EntityHeader
        breadcrumb={[{ label: "Permits", href: "/permits" }, { label: title }]}
        title={title}
        subtitle={
          <>
            <Link href={`/jobs/${permit.jobId}?tab=permits`} className="hover:underline">
              {job.primary}
            </Link>
            {" · "}
            {permit.jurisdiction?.name ?? permit.municipality}
            {permit.jurisdiction?.hvhz ? " · HVHZ" : ""}
            {permit.applicationNumber ? ` · application ${permit.applicationNumber}` : ""}
          </>
        }
        badges={
          <>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(PERMIT_STATUS_TONE[permit.status] ?? "neutral").pill)}>{PERMIT_STATUS_LABEL[permit.status] ?? permit.status}</span>
            {notice && <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(notice.tone).pill)}>{notice.text}</span>}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => v && url.set("tab", v === "overview" ? null : String(v))}>
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents ({data.files.length})</TabsTrigger>
          <TabsTrigger value="parties">Parties ({permit.parties.length})</TabsTrigger>
          <TabsTrigger value="submissions">Submissions ({permit.cycles.length})</TabsTrigger>
          <TabsTrigger value="corrections">Corrections{data.openCorrections ? ` (${data.openCorrections} open)` : ""}</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="inspections">Inspections ({permit.inspections.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <Overview detail={data} users={users} goTo={(t) => url.set("tab", t)} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <PermitDocuments detail={data} onChanged={invalidate} />
        </TabsContent>
        <TabsContent value="parties" className="mt-4">
          <PermitParties detail={data} />
        </TabsContent>
        <TabsContent value="submissions" className="mt-4">
          <PermitCycles detail={data} />
        </TabsContent>
        <TabsContent value="corrections" className="mt-4">
          <PermitCorrections detail={data} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <EntityTaskPanel context={{ permitId: permit.id, jobId: permit.jobId, label: title, href: `/permits/${permit.id}` }} invalidateKeys={[permitIntelKeys.permit(id)]} emptyText="No tasks on this permit." />
        </TabsContent>
        <TabsContent value="inspections" className="mt-4">
          <Card className="min-w-0">
            <CardContent className="pt-4">
              <PermitInspections jobId={permit.jobId} permitId={permit.id} inspections={permit.inspections} steps={data.steps} canEdit={permissions.canEdit} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <History rows={data.history} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

function Overview({ detail, users, goTo }: { detail: PermitDetail; users: AssignableUser[]; goTo: (tab: Tab) => void }) {
  const { permit, checklistSummary: sum, permissions } = detail;
  const latest = permit.cycles[0] ?? null;
  const next = latest?.outcome === "PENDING" && latest.submittedAt ? "Waiting on the building department" : permit.status === "CORRECTIONS" ? "Answer the corrections and submit again" : permit.cycles.length === 0 ? "Put the package together and submit it" : null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-1">
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">At a glance</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <dl className="grid grid-cols-2 gap-3">
              <Fact label="Coordinator">{permit.assignedTo ? `${permit.assignedTo.firstName} ${permit.assignedTo.lastName}` : "Unassigned"}</Fact>
              <Fact label="Review cycle">{permit.cycles.length ? `${latest!.number} · ${OUTCOME_LABEL[latest!.outcome].toLowerCase()}` : "Not submitted"}</Fact>
              <Fact label="Submitted">{formatDay(permit.submittedDate)}</Fact>
              <Fact label="Issued">{formatDay(permit.approvedDate)}</Fact>
              <Fact label="Expires">{formatDay(permit.expirationDate)}</Fact>
              <Fact label="Valuation">{permit.valuation ? `$${Number(permit.valuation).toLocaleString("en-US")}` : "—"}</Fact>
            </dl>
            {next && <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs">{next}</p>}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0 text-sm">
            <p>
              {sum.required ? `${sum.requiredMet} of ${sum.required} required on file` : "No checklist for this jurisdiction and type yet"}
              {sum.optional ? ` · ${sum.optionalMet} of ${sum.optional} optional` : ""}
            </p>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => goTo("documents")}>
              Open the documents
            </button>
          </CardContent>
        </Card>
        {permit.jurisdiction && (
          <Card className="min-w-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{permit.jurisdiction.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0 text-xs text-muted-foreground">
              {permit.jurisdiction.county && <p>{permit.jurisdiction.county} County{permit.jurisdiction.hvhz ? " · High-Velocity Hurricane Zone" : ""}</p>}
              {permit.jurisdiction.portalUrl && (
                <a href={permit.jurisdiction.portalUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  Permit portal
                </a>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Permit details</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <PermitEditor permit={permit} users={users} canEdit={permissions.canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  status_change: "Status changed",
  permit_party_add: "Party added",
  permit_party_update: "Party edited",
  permit_party_delete: "Party removed",
  cycle_outcome: "Department's answer recorded",
  cycle_recorded: "Submission recorded",
  submission_freeze: "Package frozen as submitted",
  submission_download: "Package downloaded",
  correction_notice_add: "Correction notice added",
  correction_notice_update: "Correction notice edited",
  correction_notice_delete: "Correction notice removed",
  correction_notice_reread: "Correction notice read again",
  correction_notice_confirm: "Corrections confirmed",
  correction_item_add: "Correction added",
  correction_item_update: "Correction updated",
  correction_item_delete: "Proposed correction deleted",
  correction_item_file_link: "Revised file linked to a correction",
  correction_item_file_unlink: "Revised file unlinked",
  correction_response_letter: "Response letter written",
  permit_message_draft: "Email drafted",
  permit_message_discard: "Email draft discarded",
  permit_message_sent: "Email sent",
};

function describe(row: HistoryRow): string {
  const a = (row.afterJson ?? {}) as Record<string, unknown>;
  const b = (row.beforeJson ?? {}) as Record<string, unknown>;
  switch (row.action) {
    case "status_change":
      return `${PERMIT_STATUS_LABEL[String(b.status)] ?? b.status} → ${PERMIT_STATUS_LABEL[String(a.status)] ?? a.status}`;
    case "permit_party_add":
    case "permit_party_update":
      return `${a.name ?? ""}`;
    case "permit_party_delete":
      return `${b.name ?? ""}`;
    case "cycle_outcome":
      return `Cycle ${a.cycle}: ${OUTCOME_LABEL[a.outcome as keyof typeof OUTCOME_LABEL] ?? a.outcome}`;
    case "submission_freeze":
      return `Cycle ${a.cycle}, ${Array.isArray(a.documents) ? a.documents.length : 0} documents`;
    case "cycle_recorded":
      return `Cycle ${a.cycle}`;
    default:
      return "";
  }
}

function History({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <Card className="min-w-0">
      <CardContent className="pt-4">
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{ACTION_LABEL[r.action] ?? r.action.replace(/_/g, " ")}</span>
                {describe(r) && <span className="text-muted-foreground"> · {describe(r)}</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {r.actor ? `${r.actor.firstName} ${r.actor.lastName} · ` : ""}
                {format(new Date(r.createdAt), "MMM d, yyyy h:mm a")}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

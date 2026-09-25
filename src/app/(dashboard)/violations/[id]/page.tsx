"use client";

import { Suspense, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, DollarSign, Gavel, Link2, ListChecks, MoreHorizontal, Pencil, RotateCcw, Route, ShieldCheck, Unlink, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityHeader } from "@/components/shared/entity-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { FilesPanel } from "@/components/files/files-panel";
import { EntityTaskPanel } from "@/components/tasks/entity-task-panel";
import { WorkflowPanel } from "@/components/workflows/job-workflow-panel";
import { ApplyWorkflowDialog } from "@/components/workflows/apply-workflow-dialog";
import { useSubjectWorkflow } from "@/components/workflows/use-workflow";
import { useSession } from "@/lib/auth/session-client";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import { describeDaysRemaining } from "@/lib/violations/dates";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { CaseAlerts } from "@/components/violations/case-alerts";
import { AgencyConfirmDialog, ChangeStatusMenu, CloseCaseDialog, DeadlineChangeDialog, EditCaseDialog, ExtensionDialog, ReopenCaseDialog } from "@/components/violations/case-dialogs";
import { ActivityPanel, CommunicationsPanel, Facts, NotesPanel, PermitsPanel, PhotosPanel } from "@/components/violations/case-tabs";
import { CaseFlags, CasePhasePill, CaseStatusPill, addressOf } from "@/components/violations/case-widgets";
import { FinesPanel } from "@/components/violations/fines-panel";
import { HearingsPanel } from "@/components/violations/hearings-panel";
import { InspectionsPanel } from "@/components/violations/inspections-panel";
import { ItemsPanel } from "@/components/violations/items-panel";
import { LinkJobDialog } from "@/components/violations/link-job-dialog";
import { NOTICE_TYPE_LABEL, SEVERITY_LABEL, SEVERITY_TONE } from "@/components/violations/status";
import { money, useCaseAction, useViolationCase, violationKeys, type CaseData } from "@/components/violations/use-violations";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "items", label: "Items" },
  { value: "workflow", label: "Workflow" },
  { value: "tasks", label: "Tasks" },
  { value: "inspections", label: "Inspections" },
  { value: "hearings", label: "Hearings" },
  { value: "permits", label: "Permits" },
  { value: "fines", label: "Fines & Liens" },
  { value: "files", label: "Documents" },
  { value: "photos", label: "Photos" },
  { value: "comms", label: "Communications" },
  { value: "notes", label: "Notes" },
  { value: "activity", label: "Activity" },
] as const;

export default function CasePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <CasePageBody />
    </Suspense>
  );
}

function CasePageBody() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useViolationCase(id);
  const { get, setMany } = useSearchParamState();
  const tabRaw = get("tab") ?? "overview";
  const tab = TABS.some((t) => t.value === tabRaw) ? tabRaw : "overview";
  const openItem = get("item");
  const setTab = (t: string) => setMany({ tab: t === "overview" ? null : t, item: null });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <Callout tone="danger" title="Couldn't load this case">
        {error instanceof Error ? error.message : "It may not exist, or you may not have access."} <Link href="/violations/list" className="underline">Back to cases</Link>
      </Callout>
    );
  }
  return <CaseView data={data} tab={tab} setTab={setTab} openItem={openItem} onOpenItem={(itemId) => setMany({ tab: "items", item: itemId })} />;
}

function CaseView({ data, tab, setTab, openItem, onOpenItem }: { data: CaseData; tab: string; setTab: (t: string) => void; openItem: string | null; onOpenItem: (id: string | null) => void }) {
  const { data: session } = useSession();
  const [dialog, setDialog] = useState<null | "edit" | "close" | "reopen" | "agency" | "deadline" | "extension" | "link" | "unlink" | "apply" | "corrective">(null);
  const { data: wf } = useSubjectWorkflow({ kind: "violation", id: data.id }, { enabled: dialog === "apply" });
  const unlink = useCaseAction<Record<string, never>>(data.id, "/link-job", { method: "DELETE", success: "Job unlinked" });
  const p = data.permissions;
  const closed = data.status === "CLOSED" || data.status === "CANCELLED";
  const address = addressOf(data.lead);
  const summary = data.workflowSummary;
  const pct = summary ? summary.percentComplete : null;
  const deadlineTone = data.state.overdue ? "danger" : data.state.deadlineInDays !== null && data.state.deadlineInDays <= 7 ? "warning" : undefined;
  const officialLabel = data.fines.officialBalance ? `Official ${money(data.fines.officialBalance.amount)} as of ${format(new Date(data.fines.officialBalance.asOf), "MMM d")}` : "No official balance entered";
  const nextAction = data.nextAction;
  const pendingExtension = data.extensions.find((e) => e.status === "REQUESTED") ?? null;

  return (
    <div>
      <EntityHeader
        breadcrumb={[{ label: "Code Violations", href: "/violations" }, { label: "All cases", href: "/violations/list" }, { label: data.caseNumber }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-muted-foreground">{data.caseNumber}</span>
            <span>{data.title}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={`/leads/${data.leadId}`} className="hover:underline">
              {address || data.lead.fullName}
            </Link>
            {data.jurisdiction && <span>{data.jurisdiction}</span>}
            {data.agencyCaseNumber && <span className="font-mono text-xs">Agency # {data.agencyCaseNumber}</span>}
            {data.job && (
              <Link href={`/jobs/${data.job.id}`} className="font-mono text-xs hover:underline">
                {data.job.jobNumber}
              </Link>
            )}
          </span>
        }
        badges={
          <>
            <CaseStatusPill status={data.status} />
            <CasePhasePill state={data.state} />
            <Badge className={cn("border-0 text-[11px]", toneClasses(SEVERITY_TONE[data.severity] ?? "neutral").pill)}>{SEVERITY_LABEL[data.severity]}</Badge>
            <CaseFlags flags={data.state.flags} />
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {p.canEdit && !closed && (
              <Button variant="outline" size="sm" onClick={() => setDialog("edit")}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
            <ChangeStatusMenu data={data} />
            {p.canClose && !closed && (
              <Button variant="brand" size="sm" onClick={() => setDialog("close")}>
                <CheckCircle2 className="size-3.5" /> Close case
              </Button>
            )}
            {p.canReopen && closed && (
              <Button variant="outline" size="sm" onClick={() => setDialog("reopen")}>
                <RotateCcw className="size-3.5" /> Reopen
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label="More actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {p.canChangeDeadline && !closed && (
                  <DropdownMenuItem onClick={() => setDialog("deadline")}>
                    <CalendarClock className="size-4" /> Change deadline
                  </DropdownMenuItem>
                )}
                {p.canChangeDeadline && !closed && (
                  <DropdownMenuItem onClick={() => setDialog("extension")}>
                    <CalendarClock className="size-4" /> {pendingExtension ? "Record extension decision" : "Request extension"}
                  </DropdownMenuItem>
                )}
                {p.canConfirmAgency && !closed && !data.agencyConfirmedAt && (
                  <DropdownMenuItem onClick={() => setDialog("agency")}>
                    <ShieldCheck className="size-4" /> Record agency confirmation
                  </DropdownMenuItem>
                )}
                {p.canEdit && !closed && !data.workflow && (
                  <DropdownMenuItem onClick={() => setDialog("apply")}>
                    <Route className="size-4" /> Apply workflow
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {p.canEdit && !closed && !data.job && (
                  <DropdownMenuItem onClick={() => setDialog("link")}>
                    <Link2 className="size-4" /> Link corrective job
                  </DropdownMenuItem>
                )}
                {p.canEdit && !closed && data.job && (
                  <DropdownMenuItem onClick={() => setDialog("unlink")}>
                    <Unlink className="size-4" /> Unlink job {data.job.jobNumber}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem render={<Link href={`/tasks?violationCaseId=${data.id}`} />}>
                  <ListChecks className="size-4" /> Open in Tasks
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {data.status === "NEW" && !data.workflow && (
        <Callout
          tone="warning"
          className="mb-4"
          title="No workflow on this case yet"
          action={
            p.canEdit ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("apply")}>
                Apply workflow
              </Button>
            ) : undefined
          }
        >
          The case was created without a workflow (no published violation template, or the apply failed). Apply one to generate the steps.
        </Callout>
      )}
      <CaseAlerts alerts={data.alerts} onGo={setTab} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Next required action"
          value={nextAction ? nextAction.title : closed ? "—" : "Nothing open"}
          icon={ListChecks}
          description={nextAction ? `${nextAction.assignedTo ? `${nextAction.assignedTo.firstName} ${nextAction.assignedTo.lastName}` : "Unassigned"}${nextAction.dueAt ? ` · due ${format(new Date(nextAction.dueAt), "MMM d")}` : ""}` : undefined}
          href={nextAction ? `/violations/${data.id}?tab=workflow&task=${nextAction.id}` : undefined}
        />
        <KpiCard
          title="Compliance deadline"
          value={data.currentDeadline ? format(new Date(data.currentDeadline), "MMM d, yyyy") : "Not set"}
          icon={data.state.overdue ? AlertTriangle : CalendarClock}
          tone={deadlineTone}
          description={data.currentDeadline ? `${describeDaysRemaining(new Date(data.currentDeadline), new Date())}${data.originalDeadline && data.originalDeadline !== data.currentDeadline ? ` · originally ${format(new Date(data.originalDeadline), "MMM d")}` : ""}` : "Enter it from the notice"}
        />
        <KpiCard title="Fine exposure (est.)" value={p.canViewFinancials ? money(data.fines.exposure) : "—"} icon={DollarSign} tone={data.fines.accruing ? "danger" : undefined} description={p.canViewFinancials ? officialLabel : "Hidden for your role"} href={`/violations/${data.id}?tab=fines`} />
        <KpiCard title="Workflow" value={pct === null ? "Not applied" : `${pct}%`} icon={Route} description={summary ? `${summary.done} of ${summary.total} steps · ${summary.currentPhase?.name ?? "done"}` : undefined} href={`/violations/${data.id}?tab=workflow`}>
          {pct !== null && <Progress value={pct} className="mt-2 h-1.5" />}
        </KpiCard>
      </div>

      <Tabs value={tab} onValueChange={(v) => v && setTab(String(v))}>
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="data-[state=active]:bg-brand-soft data-[state=active]:text-brand-fg">
              {t.label}
              {t.value === "items" && <span className="ml-1 text-[10px] text-muted-foreground">{data.items.length}</span>}
              {t.value === "hearings" && data.hearings.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground">{data.hearings.length}</span>}
              {t.value === "inspections" && data.inspections.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground">{data.inspections.length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <Overview data={data} onSetTab={setTab} />
        </TabsContent>
        <TabsContent value="items">
          <ItemsPanel data={data} openItemId={openItem} onOpenItem={onOpenItem} />
        </TabsContent>
        <TabsContent value="workflow">
          <WorkflowPanel subject={{ kind: "violation", id: data.id }} />
        </TabsContent>
        <TabsContent value="tasks">
          <EntityTaskPanel context={{ violationCaseId: data.id, label: data.caseNumber, href: `/violations/${data.id}` }} invalidateKeys={[violationKeys.detail(data.id)]} defaultAssigneeId={data.caseManagerId ?? null} emptyText="No tasks on this case yet." />
        </TabsContent>
        <TabsContent value="inspections">
          <InspectionsPanel data={data} />
        </TabsContent>
        <TabsContent value="hearings">
          <HearingsPanel data={data} />
        </TabsContent>
        <TabsContent value="permits">
          <PermitsPanel data={data} onSetPermit={() => setTab("workflow")} />
        </TabsContent>
        <TabsContent value="fines">{p.canViewFinancials ? <FinesPanel data={data} /> : <Callout tone="neutral">Fines and liens are not visible for your role.</Callout>}</TabsContent>
        <TabsContent value="files">
          <FilesPanel scope={{ leadId: data.leadId, violationCaseId: data.id }} />
        </TabsContent>
        <TabsContent value="photos">
          <PhotosPanel data={data} />
        </TabsContent>
        <TabsContent value="comms">
          <CommunicationsPanel data={data} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesPanel data={data} currentUserId={session?.user.id ?? ""} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityPanel data={data} />
        </TabsContent>
      </Tabs>

      <EditCaseDialog key={`edit-${data.updatedAt}`} data={data} open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} />
      <CloseCaseDialog data={data} open={dialog === "close"} onOpenChange={(o) => !o && setDialog(null)} />
      <ReopenCaseDialog data={data} open={dialog === "reopen"} onOpenChange={(o) => !o && setDialog(null)} />
      <AgencyConfirmDialog data={data} open={dialog === "agency"} onOpenChange={(o) => !o && setDialog(null)} />
      <DeadlineChangeDialog key={`dl-${data.currentDeadline ?? ""}`} data={data} open={dialog === "deadline"} onOpenChange={(o) => !o && setDialog(null)} />
      <ExtensionDialog key={`ext-${data.extensions.length}`} data={data} open={dialog === "extension"} onOpenChange={(o) => !o && setDialog(null)} />
      <LinkJobDialog data={data} open={dialog === "link"} onOpenChange={(o) => !o && setDialog(null)} />
      <ConfirmDialog
        open={dialog === "unlink"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Unlink ${data.job?.jobNumber ?? "the job"}?`}
        description="The job keeps its own workflow and tasks. The case's corrective-work gate and permit checks stop reading from it."
        tone="warning"
        confirmLabel="Unlink"
        pending={unlink.isPending}
        onConfirm={() => unlink.mutate({} as never, { onSuccess: () => setDialog(null) })}
      />
      {dialog === "apply" && wf && <ApplyWorkflowDialog subject={{ kind: "violation", id: data.id }} data={wf} open onOpenChange={(o) => !o && setDialog(null)} />}
    </div>
  );
}

function Overview({ data, onSetTab }: { data: CaseData; onSetTab: (t: string) => void }) {
  const p = data.permissions;
  const team = data.workflow?.team ?? [];
  const openItems = data.items.filter((i) => i.status !== "VERIFIED" && i.status !== "WITHDRAWN");
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Notice</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts
              rows={[
                ["Notice type", data.noticeType ? NOTICE_TYPE_LABEL[data.noticeType] : null],
                ["Jurisdiction", [data.jurisdiction, data.department].filter(Boolean).join(" · ") || null],
                ["Agency case #", data.agencyCaseNumber],
                ["Code officer", data.officerName ? `${data.officerName}${data.officerPhone ? ` · ${data.officerPhone}` : ""}${data.officerEmail ? ` · ${data.officerEmail}` : ""}` : null],
                ["Notice date", data.noticeDate ? format(new Date(data.noticeDate), "MMM d, yyyy") : null],
                ["Received", format(new Date(data.receivedAt), "MMM d, yyyy")],
                ["Original deadline", data.originalDeadline ? format(new Date(data.originalDeadline), "MMM d, yyyy") : null],
                ["Current deadline", data.currentDeadline ? format(new Date(data.currentDeadline), "MMM d, yyyy") : null],
                ["Appeal deadline", data.appealDeadline ? format(new Date(data.appealDeadline), "MMM d, yyyy") : null],
                ["Extension", data.extensionStatus ? `${data.extensionStatus.toLowerCase()}${data.extensionDeadline ? ` → ${format(new Date(data.extensionDeadline), "MMM d, yyyy")}` : ""}` : null],
              ]}
            />
            {data.summary && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{data.summary}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Violation items</CardTitle>
            <button type="button" className="text-xs underline" onClick={() => onSetTab("items")}>
              Open items
            </button>
          </CardHeader>
          <CardContent>
            {data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 py-1.5">
                    <span className="font-mono text-xs text-muted-foreground">#{i.itemNumber}</span>
                    <span className="min-w-0 flex-1 truncate">{i.description}</span>
                    {i.category && <span className="text-[11px] text-muted-foreground">{i.category.name}</span>}
                    <Badge variant="outline" className="text-[10px]">
                      {i.status.toLowerCase().replace("_", " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {openItems.length} open · {data.items.length - openItems.length} verified or withdrawn
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Compliance record</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts
              rows={[
                ["Corrective work", data.correctiveWorkCompletedAt ? `Complete ${format(new Date(data.correctiveWorkCompletedAt), "MMM d, yyyy")}` : data.job ? "In progress on the linked job" : data.constructionRequired ? "Required — no job linked" : "Not required"],
                ["Reinspection", data.reinspectionRequestedAt ? `Requested ${format(new Date(data.reinspectionRequestedAt), "MMM d, yyyy")}${data.finalInspectionResult ? ` · ${data.finalInspectionResult}` : ""}` : "Not requested"],
                ["Agency confirmation", data.agencyConfirmedAt ? `${format(new Date(data.agencyConfirmedAt), "MMM d, yyyy")}${data.agencyConfirmedByName ? ` by ${data.agencyConfirmedByName}` : ""}${data.agencyConfirmationMethod ? ` (${data.agencyConfirmationMethod})` : ""}${data.agencyConfirmationRef ? ` · ${data.agencyConfirmationRef}` : ""}` : <span className="text-tone-warning-fg">Not yet — required before closure</span>],
                ["Official compliance date", data.officialComplianceDate ? format(new Date(data.officialComplianceDate), "MMM d, yyyy") : null],
                ["Fines", p.canViewFinancials ? (data.fineResolvedAt ? `Resolved ${format(new Date(data.fineResolvedAt), "MMM d, yyyy")}` : data.fines.accruing ? `Accruing ${money(data.fines.accrual.dailyFine)}/day` : data.fines.officialBalance ? `Official balance ${money(data.fines.officialBalance.amount)}` : "None recorded") : "—"],
                ["Lien", data.lienStatus === "NONE" ? "None" : data.lienStatus === "RECORDED" ? `Recorded${data.lienAmount ? ` ${money(data.lienAmount)}` : ""}` : "Released"],
                ["Closed", data.closedAt ? `${format(new Date(data.closedAt), "MMM d, yyyy")}${data.closedBy ? ` by ${data.closedBy.firstName} ${data.closedBy.lastName}` : ""}${data.closureOverrideReason ? " · with override" : ""}` : null],
              ]}
            />
            {data.closureBlockers.length > 0 && !data.closedAt && (
              <div className="mt-3 rounded-md border border-dashed p-2.5 text-xs">
                <p className="mb-1 font-medium">Before this case can close</p>
                <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {data.closureBlockers.map((b) => (
                    <li key={b.key}>{b.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">People</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <UserAvatar user={data.caseManager} size="sm" />
              <div>
                <div className="text-xs text-muted-foreground">Case manager</div>
                <div>{data.caseManager ? `${data.caseManager.firstName} ${data.caseManager.lastName}` : "Unassigned"}</div>
              </div>
            </div>
            {data.responsibleRole && (
              <div className="text-xs text-muted-foreground">
                Responsible team: <span className="text-foreground">{WORKFLOW_ROLE_LABEL[data.responsibleRole]}</span>
              </div>
            )}
            {team.length > 0 && (
              <ul className="space-y-1 pt-1 text-xs">
                {team.map((t) => (
                  <li key={t.role} className="flex items-center gap-2">
                    <UserAvatar user={t.user} size="xs" />
                    <span className="text-muted-foreground">{WORKFLOW_ROLE_LABEL[t.role]}</span>
                    <span className="ml-auto">{t.user ? `${t.user.firstName} ${t.user.lastName}` : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-1 text-xs text-muted-foreground">
              Created {format(new Date(data.createdAt), "MMM d, yyyy")} by {data.createdBy.firstName} {data.createdBy.lastName}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Link href={`/leads/${data.leadId}`} className="font-medium hover:underline">
              {data.lead.fullName}
            </Link>
            <div className="text-muted-foreground">
              {data.lead.propertyAddress1}
              {data.lead.propertyAddress2 ? `, ${data.lead.propertyAddress2}` : ""}
              <br />
              {[data.lead.city, data.lead.state, data.lead.zipCode].filter(Boolean).join(", ")}
              {data.lead.county ? ` · ${data.lead.county} County` : ""}
            </div>
            {data.parcelNumber && <div className="text-xs text-muted-foreground">Parcel {data.parcelNumber}</div>}
            {data.ownerNameSnapshot && <div className="text-xs text-muted-foreground">Owner on notice: {data.ownerNameSnapshot}</div>}
            {data.lead.primaryPhone && <div className="text-xs">{data.lead.primaryPhone}</div>}
            {data.lead.email && <div className="text-xs">{data.lead.email}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Corrective job</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {data.job ? (
              <>
                <Link href={`/jobs/${data.job.id}`} className="font-mono hover:underline">
                  {data.job.jobNumber}
                </Link>{" "}
                <span>{data.job.title}</span>
                <div className="mt-1 text-xs text-muted-foreground">
                  Stage {data.job.currentStage.name}
                  {data.job.workflow ? ` · workflow ${data.job.workflow.status.toLowerCase()}` : " · no workflow"}
                  {data.job.permits.length ? ` · ${data.job.permits.length} permit${data.job.permits.length === 1 ? "" : "s"}` : ""}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">{data.constructionRequired ? "Construction is required. Link or create the job from the header menu." : "No job linked."}</p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Est. correction cost</div>
                <div className="tabular-nums">{money(data.estimatedCost)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Actual</div>
                <div className="tabular-nums">{money(data.actualCost)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Coming up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {data.nextHearingAt && (
              <button type="button" className="flex w-full items-center gap-2 text-left hover:underline" onClick={() => onSetTab("hearings")}>
                <Gavel className="size-3.5 text-muted-foreground" /> Hearing {format(new Date(data.nextHearingAt), "EEE MMM d · h:mm a")}
              </button>
            )}
            {data.nextInspectionAt && (
              <button type="button" className="flex w-full items-center gap-2 text-left hover:underline" onClick={() => onSetTab("inspections")}>
                <ClipboardCheck className="size-3.5 text-muted-foreground" /> Inspection {format(new Date(data.nextInspectionAt), "EEE MMM d · h:mm a")}
              </button>
            )}
            {data.extensionStatus === "REQUESTED" && data.extensionDeadline && (
              <div className="flex items-center gap-2">
                <CalendarClock className="size-3.5 text-muted-foreground" /> Extension pending to {format(new Date(data.extensionDeadline), "MMM d")}
              </div>
            )}
            {!data.nextHearingAt && !data.nextInspectionAt && data.extensionStatus !== "REQUESTED" && <p className="text-muted-foreground">Nothing scheduled.</p>}
            {data.status === "CANCELLED" && (
              <p className="flex items-center gap-1 text-muted-foreground">
                <XCircle className="size-3.5" /> Cancelled{data.closeReason ? ` — ${data.closeReason}` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

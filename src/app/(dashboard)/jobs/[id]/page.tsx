"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RecordRecent } from "@/components/shared/record-recent";
import { jobLabel, jobText } from "@/lib/labels/job";
import { formatAddressFull } from "@/lib/labels/address";
import { useParams, useRouter, useSearchParams, usePathname } from "next/navigation";
import { EntityHeader } from "@/components/shared/entity-header";
import { ContactCard } from "@/components/shared/contact-card";
import { JobPageSkeleton } from "@/components/jobs/job-page-skeleton";
import { PaymentsPanel } from "@/components/jobs/payments-panel";
import { JobPermitsPanel } from "@/components/jobs/job-permits-panel";
import { CrewsPanel } from "@/components/jobs/crews-panel";
import { StageHistoryList } from "@/components/jobs/stage-history-list";
import { moneyStep } from "@/lib/jobs/money-step";
import { StageStepper } from "@/components/shared/stage-stepper";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { toneClasses } from "@/lib/ui/tones";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DailyLogsPanel } from "@/components/jobs/daily-logs-panel";
import { FieldLaborSummary } from "@/components/jobs/field-labor-summary";
import { FieldAssignmentsPanel } from "@/components/jobs/field-assignments-panel";
import { JobPhotoGallery } from "@/components/photos/job-photo-gallery";
import { toast } from "sonner";
import {
  DollarSign, User, Calendar, Hammer, Shield, MoreHorizontal, CornerDownRight, Copy, ExternalLink, Wallet, FileText,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { FilesPanel } from "@/components/files/files-panel";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import { InvoicesPanel } from "@/components/jobs/invoices-panel";
import { ExpensesPanel } from "@/components/jobs/expenses-panel";
import { LaborContractsPanel } from "@/components/jobs/labor-contracts-panel";
import { ChangeOrdersPanel } from "@/components/jobs/change-orders-panel";
import { BudgetPanel } from "@/components/jobs/budget-panel";
import { CommitmentsPanel } from "@/components/jobs/commitments-panel";
import { PricingPanel } from "@/components/jobs/pricing-panel";
import { LeadEstimatesPanel } from "@/components/estimates/lead-estimates-panel";
import { RoofMeasurementsPanel } from "@/components/roofing/roof-measurements-panel";
import { ContractPanel } from "@/components/jobs/contract-panel";
import { useJobContracts } from "@/components/customer-contracts/use-customer-contracts";
import { Callout } from "@/components/shared/callout";
import { RentalTurnoverPanel } from "@/components/jobs/rental-turnover-panel";
import { TargetStartField } from "@/components/jobs/target-start-field";
import { EntityTaskPanel } from "@/components/tasks/entity-task-panel";
import { CaseListMini } from "@/components/violations/case-list-mini";
import { useTasks } from "@/components/tasks/use-tasks";
import { JobWorkflowPanel } from "@/components/workflows/job-workflow-panel";
import { useSession } from "@/lib/auth/session-client";
import { canDeleteJob } from "@/lib/access/roles";
import { DeleteJobDialog } from "@/components/jobs/delete-job-dialog";
import { JobOverview } from "@/components/jobs/job-overview";
import { CostSummaryCard, useJobCostSummary } from "@/components/jobs/cost-summary-card";
import { canEditJobRecord, canManageJobMoney } from "@/lib/money/access";
import { TeamPersonField } from "@/components/jobs/team-person-field";
import { useJobWorkflow } from "@/components/workflows/use-workflow";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import { isPastDue } from "@/lib/calendar/status";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const { data: costSummary } = useJobCostSummary(id);
  const canEditRecord = canEditJobRecord(session?.user.role);
  const moneyViewOnly = Boolean(session?.user) && !canManageJobMoney(session?.user.role);
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Fourteen tabs in one strip never fit; they are grouped, and the URL owns
  // which group + sub-panel is open so links from email keep landing.
  const sub = searchParams.get("sub") ?? "";
  // Inspections moved from Field to the permit they belong to; old links follow them.
  const tab = searchParams.get("tab") === "field" && sub === "inspections" ? "permits" : (searchParams.get("tab") ?? "overview");
  function setTab(nextTab: string, nextSub?: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", nextTab);
    if (nextSub) next.set("sub", nextSub);
    else next.delete("sub");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const {
    data: job,
    isLoading,
    error: jobError,
    refetch: refetchJob,
    isRefetching: isRefetchingJob,
  } = useQuery({
    queryKey: ["job", id],
    queryFn: () => fetchJson(`/api/jobs/${id}`),
    retry: retryServerErrors,
  });

  const { data: stages } = useQuery({
    queryKey: ["jobStages"],
    queryFn: () => fetchJson("/api/jobs/stages"),
  });

  // Scoped through /api/tasks so the count matches what this viewer may see.
  const { data: jobTasks = [] } = useTasks({ jobId: id });
  const { data: workflow } = useJobWorkflow(id);
  const { data: contracts = [], isFetched: contractsLoaded } = useJobContracts(id);
  const signedRow = contracts.find((c) => c.status === "SIGNED") ?? null;
  const signedContract = signedRow ? { id: signedRow.id, contractNumber: signedRow.contractNumber, signedAt: signedRow.signedAt ?? signedRow.updatedAt, contractAmount: signedRow.contractAmount } : null;
  const awaitingSignature = contracts.filter((c) => c.status === "SENT").length;
  // Money opens on the panel with work left in it (only when the URL has no ?sub).
  const moneyNext = moneyStep(job ?? { jobType: "FIXED_PRICE", contractAmount: 0 }, contracts);

  const { data: budgetLines = [] } = useQuery<{ amount: string }[]>({
    queryKey: ["budget", id],
    queryFn: () => fetchJson(`/api/jobs/${id}/budget`),
    enabled: Boolean(job),
  });
  const totalBudget = budgetLines.reduce((s, l) => s + Number(l.amount), 0);

  const changeStage = useMutation({
    mutationFn: (stageId: string) =>
      fetchJson(`/api/jobs/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["job", id] }); toast.success("Stage updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <JobPageSkeleton />;

  // A job that isn't there and a job we couldn't reach are different problems
  // with different remedies. Reporting both as "not found" once sent people
  // looking for a deleted record while the database was simply unreachable.
  if (jobError || !job) {
    const missing = jobError instanceof HttpError && jobError.isNotFound;
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <div>
          <p className="font-medium">
            {missing ? "Job not found" : "Couldn't load this job"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {missing
              ? "It may have been deleted, or the link may be wrong."
              : jobError instanceof Error
                ? jobError.message
                : "Something went wrong loading this job."}
          </p>
        </div>
        <div className="flex gap-2">
          {!missing && (
            <Button
              variant="outline"
              onClick={() => refetchJob()}
              disabled={isRefetchingJob}
            >
              {isRefetchingJob ? "Retrying..." : "Try again"}
            </Button>
          )}
          <Button variant={missing ? "outline" : "ghost"} onClick={() => router.push("/jobs")}>
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  // The workflow team's PM / sales rep slots are the job's PM / sales rep
  // (the route mirrors them into the job's fields); read the slot first so a
  // save on the Workflow tab shows here before the job refetches.
  const teamSlot = (role: "PROJECT_MANAGER" | "SALES_REP") => workflow?.team?.find((t) => t.role === role)?.user ?? null;
  const teamPm = teamSlot("PROJECT_MANAGER") ?? job.projectManager ?? null;
  const teamSales = teamSlot("SALES_REP") ?? job.salesRep ?? null;

  const depositPct = Number(job.depositRequired) > 0
    ? Math.round((Number(job.depositReceived) / Number(job.depositRequired)) * 100) : 0;
  const totalPaid = (job.payments || [])
    .filter((p: { status: string }) => p.status === "RECEIVED")
    .reduce((sum: number, p: { amount: string }) => sum + Number(p.amount), 0);

  return (
    <div>
      <RecordRecent item={{ type: "job", id, primary: jobLabel(job).primary, secondary: jobLabel(job).secondary, code: job.jobNumber, href: `/jobs/${id}` }} />
      <EntityHeader
        breadcrumb={[{ label: "Jobs", href: "/jobs" }, { label: jobLabel(job).primary }]}
        title={jobLabel(job).primary}
        subtitle={
          <>
            <span className="font-mono text-xs text-muted-foreground">{job.jobNumber}</span>
            {" · "}
            {job.serviceType}
            {" · "}
            <Link href={`/leads/${job.lead.id}`} className="text-brand-fg hover:underline">
              {job.lead.fullName}
            </Link>
            {(job.targetStartDate || workflow?.permissions.canCoordinate) && " · "}
            <TargetStartField
              jobId={id}
              value={job.targetStartDate ?? null}
              canEdit={Boolean(workflow?.permissions.canCoordinate)}
              hasWorkflow={Boolean(workflow?.instance)}
            />
          </>
        }
        badges={
          <Badge variant="outline" className="text-xs">
            {job.jobType === "COST_PLUS" ? "Cost-plus" : job.jobType === "OWNED_REHAB" ? "Owned rehab" : "Fixed price"}
          </Badge>
        }
        actions={
          <>
            {job.nextAction && (
              <span className="inline-flex max-w-md items-center gap-1.5 rounded-md bg-tone-warning-soft px-3 py-1.5 text-sm font-medium text-tone-warning-fg">
                <CornerDownRight className="size-3.5 shrink-0" />
                <span className="truncate">{job.nextAction}</span>
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push(`/leads/${job.lead.id}`)}>
                  <ExternalLink className="size-4" /> Open lead
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTab("money", "payments")}>
                  <Wallet className="size-4" /> Record payment
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTab("money", "estimates")}>
                  <FileText className="size-4" /> Estimates
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard?.writeText(job.jobNumber);
                    toast.success("Job number copied");
                  }}
                >
                  <Copy className="size-4" /> Copy job number
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard?.writeText(formatAddressFull(job.lead));
                    toast.success("Address copied");
                  }}
                >
                  <Copy className="size-4" /> Copy address
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTab("history")}>Stage history</DropdownMenuItem>
                {canDeleteJob(session?.user.role) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="size-4" /> Delete job…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DeleteJobDialog jobId={id} jobName={jobLabel(job).primary} open={deleteOpen} onOpenChange={setDeleteOpen} />
          </>
        }
      >
        {stages && (
          <StageStepper
            stages={stages}
            currentStageId={job.currentStage.id}
            entityLabel={jobLabel(job).primary}
            disabled={changeStage.isPending}
            onChange={(stageId) => changeStage.mutate(stageId)}
            confirmNote={() => "Moving a job runs its stage templates: new tasks may be raised and the next action updated."}
          />
        )}
      </EntityHeader>

      {/* Financial summary cards */}
      {job.jobType === "OWNED_REHAB" ? (
        <div className={`grid gap-4 mb-6 ${totalBudget > 0 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <DollarSign className="h-4 w-4" /> Labor contract
              </div>
              <div className="text-2xl font-bold">${Number(job.laborCost ?? 0).toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <DollarSign className="h-4 w-4" /> Expenses
              </div>
              <div className="text-2xl font-bold">
                ${Math.max(0, Number(job.contractAmount) - Number(job.laborCost ?? 0)).toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <DollarSign className="h-4 w-4" /> Total job cost
              </div>
              <div className="text-2xl font-bold">${Number(job.contractAmount).toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground mt-1">Labor + all expenses spent</div>
            </CardContent>
          </Card>
          {totalBudget > 0 && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" /> Budget
                </div>
                <div className="text-2xl font-bold">${totalBudget.toLocaleString()}</div>
                {(() => {
                  const v = totalBudget - Number(job.contractAmount);
                  return (
                    <div className={`text-[11px] mt-1 font-medium ${v >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ${Math.abs(v).toLocaleString()} {v >= 0 ? "under budget" : "over budget"}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6">
        <KpiCard
          title={job.jobType === "COST_PLUS" ? "Contract (cost-plus)" : "Contract"}
          value={`$${Number(job.contractAmount).toLocaleString()}`}
          icon={DollarSign}
          description={job.jobType === "COST_PLUS" ? `Labor $${Number(job.laborCost ?? 0).toLocaleString()} + expenses + margin` : undefined}
        />
        <KpiCard title="Deposit" value={`$${Number(job.depositReceived).toLocaleString()}`} icon={DollarSign}>
          <div className="mt-2 flex items-center gap-2">
            <Progress
              value={depositPct}
              className="h-1.5 flex-1"
              indicatorClassName={depositPct >= 100 ? toneClasses("success").dot : toneClasses("warning").dot}
              label={`Deposit ${depositPct}%`}
            />
            <span className="text-xs tabular-nums text-muted-foreground">{depositPct}%</span>
          </div>
        </KpiCard>
        <KpiCard title="Total Paid" value={`$${totalPaid.toLocaleString()}`} icon={DollarSign} tone="success" />
        <KpiCard
          title="Balance Due"
          value={`$${Number(job.balanceDue).toLocaleString()}`}
          icon={DollarSign}
          tone={Number(job.balanceDue) > 0 ? "danger" : "success"}
        />
      </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="order-2 space-y-4 lg:order-1">
          <ContactCard
            name={job.lead.fullName}
            nameHref={`/leads/${job.lead.id}`}
            companyName={job.lead.companyName}
            phone={job.lead.primaryPhone}
            secondaryPhone={job.lead.secondaryPhone}
            email={job.lead.email}
            address={job.lead}
            county={job.lead.county}
            propertyType={job.lead.propertyType}
          />

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Team</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <TeamPersonField jobId={id} field="salesRepId" label="Sales" value={teamSales} canEdit={canEditRecord} />
              </div>
              <div className="flex items-center gap-2">
                <Hammer className="h-4 w-4 text-muted-foreground" />
                <TeamPersonField jobId={id} field="projectManagerId" label="PM" value={teamPm} canEdit={canEditRecord} />
              </div>
              {(workflow?.team ?? []).filter((t) => t.role !== "PROJECT_MANAGER" && t.role !== "SALES_REP").map((t) => (
                <div key={t.role} className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {WORKFLOW_ROLE_LABEL[t.role]}: {t.user.firstName} {t.user.lastName}
                  </span>
                </div>
              ))}
              {job.jurisdiction && (
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span>Jurisdiction: {job.jurisdiction}</span>
                </div>
              )}
              {job.scheduledDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Scheduled: {format(new Date(job.scheduledDate), "MMM d, yyyy")}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Financing</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>Required: {job.financingRequired ? "Yes" : "No"}</div>
              {job.financingRequired && (
                <>
                  <div>Status: <Badge variant="outline" className="text-xs">{job.financingStatus}</Badge></div>
                  {job.financingProvider && <div>Provider: {job.financingProvider}</div>}
                </>
              )}
            </CardContent>
          </Card>

          <PricingPanel job={job} signedContract={signedContract} />
          <RentalTurnoverPanel job={job} />
        </div>

        {/* Right column: tabs */}
        <div className="order-1 min-w-0 lg:order-2 lg:col-span-2">
          {moneyViewOnly && (tab === "money" || tab === "field") && (
            <Callout tone="neutral" className="mb-4" title="View only">
              Payments, invoices, labor contracts, budgets and pricing are changed by an admin, a manager or office staff. You can still add job expenses if you have that permission.
            </Callout>
          )}
          {contractsLoaded && moneyNext.title && (
            <Callout
              tone="info"
              className="mb-4"
              title={moneyNext.title}
              action={
                <Button size="sm" variant="outline" onClick={() => setTab("money", moneyNext.panel)}>
                  {moneyNext.panel === "estimates" ? "Open estimates" : "Open contract"}
                </Button>
              }
            >
              {moneyNext.body}
            </Callout>
          )}
          {(() => {
            const MONEY = [
              { value: "estimates", label: "Estimates" },
              { value: "payments", label: `Payments (${job.payments?.length || 0})` },
              { value: "invoices", label: "Invoices" },
              { value: "expenses", label: "Expenses" },
              { value: "change-orders", label: "Change orders" },
              { value: "contract", label: awaitingSignature > 0 ? `Contract (${awaitingSignature})` : "Contract" },
              { value: "budget", label: "Budget" },
              { value: "commitments", label: "Commitments" },
            ];
            const FIELD = [
              { value: "labor", label: "Labor" },
              { value: "crews", label: "Crews" },
              { value: "daily-logs", label: "Daily logs" },
              { value: "photos", label: "Photos" },
            ];
            const overdueTasks = jobTasks.filter(
              (t) => isPastDue(t.dueAt, t.allDay) && t.status !== "COMPLETED" && t.status !== "CANCELLED",
            ).length;
            const group = tab;
            const panel =
              group === "money" ? (MONEY.some((m) => m.value === sub) ? sub : moneyNext.panel)
              : group === "field" ? (FIELD.some((f) => f.value === sub) ? sub : "labor")
              : group;
            const count = (n: number, tone?: "danger") => (
              <span className={`ml-1 rounded-full px-1.5 text-[11px] tabular-nums ${tone === "danger" ? "bg-tone-danger-soft text-tone-danger-fg" : "bg-gray-100 text-gray-600"}`}>{n}</span>
            );
            return (
          <Tabs value={panel} onValueChange={(v) => { if (v) setTab(group, group === "money" || group === "field" ? String(v) : undefined); }}>
            <div className="mb-4 space-y-3">
              <div className="flex flex-wrap items-center gap-1 border-b">
                {[
                  { value: "overview", label: "Overview" },
                  {
                    value: "workflow",
                    label: (
                      <>
                        Workflow
                        {workflow?.progress
                          ? workflow.progress.overdue > 0
                            ? count(workflow.progress.overdue, "danger")
                            : workflow.progress.ready > 0
                              ? count(workflow.progress.ready)
                              : null
                          : null}
                      </>
                    ),
                  },
                  { value: "money", label: "Money" },
                  { value: "field", label: "Field" },
                  { value: "permits", label: <>Permits{count(job.permits?.length || 0)}</> },
                  { value: "tasks", label: <>Tasks{overdueTasks > 0 ? count(overdueTasks, "danger") : count(jobTasks.length)}</> },
                  { value: "files", label: "Files" },
                  { value: "violations", label: "Violations" },
                  { value: "history", label: "History" },
                ].map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setTab(g.value, g.value === "money" ? (MONEY.some((m) => m.value === sub) ? sub : moneyNext.panel) : g.value === "field" ? (FIELD.some((f) => f.value === sub) ? sub : "labor") : undefined)}
                    className={`-mb-px inline-flex h-9 items-center border-b-2 px-3 text-sm font-medium transition-colors ${
                      group === g.value ? "border-brand text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              {group === "money" && (
                <SegmentedControl ariaLabel="Money" value={panel} onValueChange={(v) => setTab("money", v)} options={MONEY} />
              )}
              {group === "field" && (
                <SegmentedControl ariaLabel="Field" value={panel} onValueChange={(v) => setTab("field", v)} options={FIELD} />
              )}
            </div>
            <TabsList className="hidden">
              {[...MONEY, ...FIELD, { value: "overview" }, { value: "workflow" }, { value: "permits" }, { value: "tasks" }, { value: "files" }, { value: "violations" }, { value: "history" }].map((t) => (
                <TabsTrigger key={t.value} value={t.value}>{t.value}</TabsTrigger>
              ))}
            </TabsList>

            {group === "money" && (
              <CostSummaryCard
                jobId={id}
                onOpenBudget={() => setTab("money", "budget")}
                onOpenLabor={() => setTab("field", "labor")}
                onOpenCommitments={() => setTab("money", "commitments")}
              />
            )}

            <TabsContent value="overview">
              <JobOverview jobId={id} onNavigate={setTab} />
            </TabsContent>

            <TabsContent value="workflow">
              <JobWorkflowPanel jobId={id} />
            </TabsContent>

            <TabsContent value="estimates">
              <div className="space-y-6">
                <LeadEstimatesPanel
                  leadId={job.leadId}
                  services={job.lead?.services ?? []}
                  jobId={id}
                />
                <RoofMeasurementsPanel leadId={job.leadId} jobId={id} />
              </div>
            </TabsContent>

            <TabsContent value="payments">
              <PaymentsPanel jobId={id} payments={job.payments ?? []} />
            </TabsContent>

            <TabsContent value="contract">
              <ContractPanel jobId={id} job={{ contractAmount: String(job.contractAmount ?? 0), jobType: job.jobType, billingMethod: job.billingMethod, lead: { email: job.lead?.email ?? null, fullName: job.lead?.fullName ?? "" } }} />
            </TabsContent>

            <TabsContent value="invoices">
              <InvoicesPanel
                jobId={id}
                billingMethod={job.billingMethod ?? "LUMP_SUM"}
                retainagePercent={Number(job.retainagePercent ?? 0)}
              />
            </TabsContent>

            <TabsContent value="expenses">
              <ExpensesPanel
                jobId={id}
                jobType={job.jobType}
                contractAmount={Number(job.contractAmount)}
                costPlus={
                  job.jobType === "COST_PLUS" || job.jobType === "OWNED_REHAB"
                    ? {
                        laborCost: Number(job.laborCost ?? 0),
                        marginType: job.marginType,
                        marginValue: Number(job.marginValue ?? 0),
                      }
                    : undefined
                }
                laborTotal={Number(job.laborCost ?? 0)}
                isRentalTurnover={Boolean(job.isRentalTurnover)}
              />
            </TabsContent>

            <TabsContent value="labor">
              <LaborContractsPanel jobId={id} />
            </TabsContent>

            <TabsContent value="change-orders">
              <ChangeOrdersPanel jobId={id} jobType={job.jobType} billingMethod={job.billingMethod} />
            </TabsContent>

            <TabsContent value="permits">
              <JobPermitsPanel jobId={id} />
            </TabsContent>

            <TabsContent value="crews">
              <CrewsPanel jobId={id} crewAssignments={job.crewAssignments ?? []} targetStartDate={job.targetStartDate ?? null} canSetStart={Boolean(workflow?.permissions.canCoordinate)} />
            </TabsContent>

            <TabsContent value="daily-logs">
              <FieldAssignmentsPanel jobId={id} />
              <FieldLaborSummary jobId={id} />
              <DailyLogsPanel jobId={id} />
            </TabsContent>

            <TabsContent value="photos">
              <JobPhotoGallery jobId={id} />
            </TabsContent>

            <TabsContent value="tasks">
              <EntityTaskPanel
                context={{
                  jobId: id,
                  label: jobText(job),
                  href: `/jobs/${id}`,
                }}
                invalidateKeys={[["job", id]]}
                defaultAssigneeId={job.projectManagerId ?? job.salesRepId ?? null}
                emptyText="No tasks on this job yet."
              />
            </TabsContent>

            <TabsContent value="files">
              <FilesPanel scope={{ leadId: job.leadId, jobId: id }} />
            </TabsContent>

            {(
              <TabsContent value="budget">
                <BudgetPanel jobId={id} totalJobCost={job.jobType === "OWNED_REHAB" ? Number(job.contractAmount) : (costSummary?.committed ?? 0)} />
              </TabsContent>
            )}

            <TabsContent value="commitments">
              <CommitmentsPanel jobId={id} onOpenLabor={() => setTab("field", "labor")} />
            </TabsContent>

            <TabsContent value="violations">
              <CaseListMini scope={{ jobId: id, leadId: job.leadId }} newHref={`/violations/new?leadId=${job.leadId}&jobId=${id}`} linkAction />
            </TabsContent>

            <TabsContent value="history">
              <StageHistoryList history={job.stageHistory ?? []} />
            </TabsContent>
          </Tabs>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

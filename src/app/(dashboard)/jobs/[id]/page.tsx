"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { EntityHeader } from "@/components/shared/entity-header";
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
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DailyLogsPanel } from "@/components/jobs/daily-logs-panel";
import { FieldLaborSummary } from "@/components/jobs/field-labor-summary";
import { FieldAssignmentsPanel } from "@/components/jobs/field-assignments-panel";
import { JobPersonnelScopePanel } from "@/components/jobs/job-personnel-scope-panel";
import { JobPhotoGallery } from "@/components/photos/job-photo-gallery";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  DollarSign, MapPin, User, Calendar, Hammer, Shield, ClipboardCheck, MoreHorizontal, CornerDownRight, Copy, ExternalLink, Wallet, FileText,
} from "lucide-react";
import Link from "next/link";
import { FilesPanel } from "@/components/files/files-panel";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import { InvoicesPanel } from "@/components/jobs/invoices-panel";
import { ExpensesPanel } from "@/components/jobs/expenses-panel";
import { LaborContractsPanel } from "@/components/jobs/labor-contracts-panel";
import { ChangeOrdersPanel } from "@/components/jobs/change-orders-panel";
import { BudgetPanel } from "@/components/jobs/budget-panel";
import { PricingPanel } from "@/components/jobs/pricing-panel";
import { LeadEstimatesPanel } from "@/components/estimates/lead-estimates-panel";
import { ContractPanel } from "@/components/jobs/contract-panel";
import { useJobContracts } from "@/components/customer-contracts/use-customer-contracts";
import { Callout } from "@/components/shared/callout";
import { RentalTurnoverPanel } from "@/components/jobs/rental-turnover-panel";
import { EntityTaskPanel } from "@/components/tasks/entity-task-panel";
import { useTasks } from "@/components/tasks/use-tasks";
import { JobWorkflowPanel } from "@/components/workflows/job-workflow-panel";
import { useJobWorkflow } from "@/components/workflows/use-workflow";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Fourteen tabs in one strip never fit; they are grouped, and the URL owns
  // which group + sub-panel is open so links from email keep landing.
  const tab = searchParams.get("tab") ?? "workflow";
  const sub = searchParams.get("sub") ?? "";
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

  const { data: crews = [] } = useQuery<{ id: string; name: string; trades: string[] }[]>({
    queryKey: ["crews", "active"],
    queryFn: () => fetchJson("/api/crews?activeOnly=true"),
  });

  const [assignCrewId, setAssignCrewId] = useState("");
  const [assignInstallDate, setAssignInstallDate] = useState("");

  const assignCrew = useMutation({
    mutationFn: (data: { crewId: string; installDate: string }) =>
      fetchJson(`/api/jobs/${id}/crews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crewId: data.crewId,
          installDate: data.installDate || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      setAssignCrewId("");
      setAssignInstallDate("");
      toast.success("Crew assigned");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: budgetLines = [] } = useQuery<{ amount: string }[]>({
    queryKey: ["budget", id],
    queryFn: () => fetchJson(`/api/jobs/${id}/budget`),
    enabled: job?.jobType === "OWNED_REHAB",
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

  const [payAmount, setPayAmount] = useState("");
  const [payType, setPayType] = useState("DEPOSIT");
  const [payMethod, setPayMethod] = useState("CHECK");
  const [payReference, setPayReference] = useState("");
  const [payInvoiceId, setPayInvoiceId] = useState("__none");

  const { data: jobInvoices = [] } = useQuery<
    { id: string; invoiceNumber: string; amount: string; status: string }[]
  >({
    queryKey: ["invoices", id],
    queryFn: () => fetchJson(`/api/jobs/${id}/invoices`),
  });
  const openInvoices = jobInvoices.filter(
    (inv) => inv.status !== "PAID" && inv.status !== "VOID",
  );

  const refreshFinancials = () => {
    qc.invalidateQueries({ queryKey: ["job", id] });
    qc.invalidateQueries({ queryKey: ["invoices", id] });
  };

  const recordPayment = useMutation({
    mutationFn: (data: {
      paymentType: string;
      amount: number;
      method: string;
      reference: string;
      invoiceId?: string | null;
    }) =>
      fetchJson(`/api/jobs/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      refreshFinancials();
      setPayAmount("");
      setPayReference("");
      setPayInvoiceId("__none");
      toast.success("Payment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePayment = useMutation({
    mutationFn: (paymentId: string) =>
      fetchJson(`/api/payments/${paymentId}`, { method: "DELETE" }),
    onSuccess: () => {
      refreshFinancials();
      toast.success("Payment deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emptyPermitForm = {
    municipality: "",
    permitType: "",
    permitNumber: "",
    submittedDate: new Date().toISOString().slice(0, 10),
    expectedApprovalDate: "",
    expirationDate: "",
    permitFee: "",
    inspectorName: "",
    assignedUserId: "",
    notes: "",
  };
  const [permitForm, setPermitForm] = useState(emptyPermitForm);
  const setPermitField = (k: keyof typeof emptyPermitForm, v: string) =>
    setPermitForm((f) => ({ ...f, [k]: v }));

  const { data: jobUsers = [] } = useQuery<{ id: string; firstName: string; lastName: string }[]>({
    queryKey: ["assignable-users"],
    queryFn: () => fetchJson("/api/users/assignable"),
  });

  const addPermit = useMutation({
    mutationFn: (data: typeof emptyPermitForm) =>
      fetchJson(`/api/jobs/${id}/permits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          assignedUserId: data.assignedUserId || null,
          permitFee: data.permitFee || null,
          expectedApprovalDate: data.expectedApprovalDate || null,
          expirationDate: data.expirationDate || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      setPermitForm(emptyPermitForm);
      toast.success("Permit added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading...</p></div>;

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

  const depositPct = Number(job.depositRequired) > 0
    ? Math.round((Number(job.depositReceived) / Number(job.depositRequired)) * 100) : 0;
  const totalPaid = (job.payments || [])
    .filter((p: { status: string }) => p.status === "RECEIVED")
    .reduce((sum: number, p: { amount: string }) => sum + Number(p.amount), 0);

  return (
    <div>
      <EntityHeader
        breadcrumb={[{ label: "Jobs", href: "/jobs" }, { label: job.jobNumber }]}
        title={job.jobNumber}
        subtitle={
          <>
            {job.title}
            {" · "}
            <Link href={`/leads/${job.lead.id}`} className="text-brand-fg hover:underline">
              {job.lead.fullName}
            </Link>
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTab("history")}>Stage history</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        {stages && (
          <StageStepper
            stages={stages}
            currentStageId={job.currentStage.id}
            entityLabel={job.jobNumber}
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
      <div className="grid gap-4 md:grid-cols-4 mb-6">
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
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Property</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div>{job.lead.propertyAddress1}</div>
                  <div>{job.lead.city}, {job.lead.state} {job.lead.zipCode}</div>
                  {job.lead.county && <div className="text-muted-foreground">{job.lead.county} County</div>}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Team</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>Sales: {job.salesRep ? `${job.salesRep.firstName} ${job.salesRep.lastName}` : "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Hammer className="h-4 w-4 text-muted-foreground" />
                <span>PM: {job.projectManager ? `${job.projectManager.firstName} ${job.projectManager.lastName}` : "—"}</span>
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
        <div className="lg:col-span-2">
          {job.jobType === "FIXED_PRICE" && Number(job.contractAmount) === 0 && contractsLoaded && contracts.length === 0 && (
            <Callout
              tone="info"
              className="mb-4"
              title="Next: create an estimate, then generate the contract"
              action={
                <Button size="sm" variant="outline" onClick={() => setTab("money", "estimates")}>
                  Open estimates
                </Button>
              }
            >
              This job has no contract amount yet. Build the estimate under Money → Estimates, mark it accepted, and generate the customer contract from it.
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
              ...(job.jobType === "OWNED_REHAB" ? [{ value: "budget", label: "Budget" }] : []),
            ];
            const FIELD = [
              { value: "labor", label: "Labor" },
              { value: "crews", label: "Crews" },
              { value: "daily-logs", label: "Daily logs" },
              { value: "photos", label: "Photos" },
              { value: "inspections", label: "Inspections" },
            ];
            const overdueTasks = jobTasks.filter(
              (t) => t.dueAt && new Date(t.dueAt) < new Date() && t.status !== "COMPLETED" && t.status !== "CANCELLED",
            ).length;
            const group = tab;
            const panel =
              group === "money" ? (MONEY.some((m) => m.value === sub) ? sub : "payments")
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
                  { value: "history", label: "History" },
                ].map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setTab(g.value, g.value === "money" ? (MONEY.some((m) => m.value === sub) ? sub : "payments") : g.value === "field" ? (FIELD.some((f) => f.value === sub) ? sub : "labor") : undefined)}
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
              {[...MONEY, ...FIELD, { value: "workflow" }, { value: "permits" }, { value: "tasks" }, { value: "files" }, { value: "history" }].map((t) => (
                <TabsTrigger key={t.value} value={t.value}>{t.value}</TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="workflow">
              <JobWorkflowPanel jobId={id} />
            </TabsContent>

            <TabsContent value="estimates">
              <LeadEstimatesPanel
                leadId={job.leadId}
                services={job.lead?.services ?? []}
                jobId={id}
              />
            </TabsContent>

            <TabsContent value="payments" className="space-y-4">
              <Card>
                <CardContent className="space-y-2 pt-4">
                  <div className="flex flex-wrap gap-2">
                    <Select value={payType} onValueChange={(v: string | null) => setPayType(v ?? "DEPOSIT")}>
                      <SelectTrigger className="w-[150px]">
                        <SelectValue>{(v: string) => v?.replace("_", " ") || "Type"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DEPOSIT">Deposit</SelectItem>
                        <SelectItem value="PROGRESS">Progress</SelectItem>
                        <SelectItem value="FINAL">Final</SelectItem>
                        <SelectItem value="FINANCING_FUNDING">Financing</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={payMethod} onValueChange={(v: string | null) => setPayMethod(v ?? "CHECK")}>
                      <SelectTrigger className="w-[130px]">
                        <SelectValue>{(v: string) => v || "Method"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CHECK">Check</SelectItem>
                        <SelectItem value="CARD">Card</SelectItem>
                        <SelectItem value="ACH">ACH</SelectItem>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="FINANCING">Financing</SelectItem>
                        <SelectItem value="WIRE">Wire</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number" placeholder="Amount" value={payAmount}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayAmount(e.target.value)}
                      className="w-[130px]"
                    />
                    <Input
                      placeholder="Check # / ref."
                      value={payReference}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayReference(e.target.value)}
                      className="w-[160px]"
                    />
                    <Select value={payInvoiceId} onValueChange={(v: string | null) => setPayInvoiceId(v ?? "__none")}>
                      <SelectTrigger className="w-[190px]">
                        <SelectValue>{(v: string) => (v === "__none" || !v ? "Apply to invoice (optional)" : v)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">No invoice</SelectItem>
                        {openInvoices.map((inv) => (
                          <SelectItem key={inv.id} value={inv.id}>
                            {inv.invoiceNumber} — ${Number(inv.amount).toLocaleString()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" disabled={!payAmount || recordPayment.isPending}
                      onClick={() => recordPayment.mutate({
                        paymentType: payType,
                        amount: Number(payAmount),
                        method: payMethod,
                        reference: payReference,
                        invoiceId: payInvoiceId === "__none" ? null : payInvoiceId,
                      })}>
                      Record Payment
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-2">
                {job.payments?.map((p: { id: string; paymentType: string; method: string | null; reference: string | null; amount: string; status: string; receivedDate: string | null; notes: string | null }) => (
                  <Card key={p.id}>
                    <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-xs">{p.paymentType}</Badge>
                          {p.method && (
                            <Badge variant="secondary" className="text-xs">{p.method}</Badge>
                          )}
                          <span className="font-medium">${Number(p.amount).toLocaleString()}</span>
                          {p.reference && (
                            <span className="text-xs text-muted-foreground">#{p.reference}</span>
                          )}
                        </div>
                        {p.notes && <div className="mt-1 text-xs text-muted-foreground">{p.notes}</div>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {p.receivedDate ? format(new Date(p.receivedDate), "MMM d, yyyy") : p.status}
                        {p.status === "RECEIVED" && (
                          <a
                            href={`/api/payments/${p.id}/receipt`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50"
                          >
                            Receipt PDF
                          </a>
                        )}
                        <button
                          onClick={() => {
                            if (confirm("Delete this payment? The balance will be recomputed."))
                              deletePayment.mutate(p.id);
                          }}
                          className="rounded border px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {!job.payments?.length && <p className="py-6 text-center text-sm text-muted-foreground">No payments recorded</p>}
              </div>
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

            <TabsContent value="permits" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Add a permit</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-[11px]">Municipality *</Label>
                      <Input value={permitForm.municipality}
                        onChange={(e) => setPermitField("municipality", e.target.value)} placeholder="City of Boca Raton" />
                    </div>
                    <div>
                      <Label className="text-[11px]">Permit type</Label>
                      <Input value={permitForm.permitType}
                        onChange={(e) => setPermitField("permitType", e.target.value)} placeholder="Re-roof, Electrical, …" />
                    </div>
                    <div>
                      <Label className="text-[11px]">Permit #</Label>
                      <Input value={permitForm.permitNumber}
                        onChange={(e) => setPermitField("permitNumber", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Coordinator</Label>
                      <Select value={permitForm.assignedUserId || "unassigned"}
                        onValueChange={(v: string | null) => v && setPermitField("assignedUserId", v === "unassigned" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {jobUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">Submitted</Label>
                      <Input type="date" value={permitForm.submittedDate}
                        onChange={(e) => setPermitField("submittedDate", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Expected approval</Label>
                      <Input type="date" value={permitForm.expectedApprovalDate}
                        onChange={(e) => setPermitField("expectedApprovalDate", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Expires</Label>
                      <Input type="date" value={permitForm.expirationDate}
                        onChange={(e) => setPermitField("expirationDate", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Permit fee</Label>
                      <Input value={permitForm.permitFee} inputMode="decimal" placeholder="0.00"
                        onChange={(e) => setPermitField("permitFee", e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[11px]">Inspector</Label>
                      <Input value={permitForm.inspectorName}
                        onChange={(e) => setPermitField("inspectorName", e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[11px]">Notes</Label>
                      <Textarea rows={2} value={permitForm.notes}
                        onChange={(e) => setPermitField("notes", e.target.value)} />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm"
                      disabled={!permitForm.municipality || addPermit.isPending}
                      onClick={() => addPermit.mutate(permitForm)}
                    >
                      Add permit
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-2">
                {job.permits?.map((p: { id: string; permitType: string | null; municipality: string; status: string; permitNumber: string | null; submittedDate: string | null; approvedDate: string | null; expirationDate?: string | null }) => (
                  <Card key={p.id}>
                    <CardContent className="flex items-center justify-between py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm font-medium">{p.permitType || "General"}</span>
                          <span className="text-xs text-muted-foreground ml-2">({p.municipality})</span>
                          {p.permitNumber && <span className="text-xs ml-2">#{p.permitNumber}</span>}
                          {p.expirationDate && (
                            <span className="text-[10px] text-muted-foreground ml-2">
                              exp {format(new Date(p.expirationDate), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">{p.status}</Badge>
                    </CardContent>
                  </Card>
                ))}
                {!job.permits?.length && <p className="py-6 text-center text-sm text-muted-foreground">No permits</p>}
              </div>
            </TabsContent>

            <TabsContent value="crews" className="space-y-2">
              <Card>
                <CardContent className="flex flex-wrap items-end gap-2 pt-4">
                  <div className="flex-1 min-w-[180px]">
                    <Label className="text-[11px]">Crew</Label>
                    <Select value={assignCrewId || "__none"}
                      onValueChange={(v: string | null) => setAssignCrewId(!v || v === "__none" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a crew">
                          {(v: string) => (!v || v === "__none" ? "Select a crew" : crews.find((c) => c.id === v)?.name || "Select a crew")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {crews.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}{c.trades?.length ? ` — ${c.trades.join(", ")}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Install date (optional)</Label>
                    <Input type="date" value={assignInstallDate}
                      onChange={(e) => setAssignInstallDate(e.target.value)} />
                  </div>
                  <Button size="sm" disabled={!assignCrewId || assignCrew.isPending}
                    onClick={() => assignCrew.mutate({ crewId: assignCrewId, installDate: assignInstallDate })}>
                    Assign crew
                  </Button>
                </CardContent>
              </Card>
              {job.crewAssignments?.map((ca: { id: string; crew: { name: string; trades: string[] }; installDate: string | null }) => (
                <Card key={ca.id}>
                  <CardContent className="flex items-center justify-between py-3 px-4">
                    <div>
                      <span className="text-sm font-medium">{ca.crew.name}</span>
                      <Badge variant="outline" className="text-[10px] ml-2">{ca.crew.trades?.join(", ") || "—"}</Badge>
                    </div>
                    {ca.installDate && <span className="text-xs text-muted-foreground">{format(new Date(ca.installDate), "MMM d, yyyy")}</span>}
                  </CardContent>
                </Card>
              ))}
              {!job.crewAssignments?.length && <p className="py-6 text-center text-sm text-muted-foreground">No crews assigned</p>}
              <JobPersonnelScopePanel jobId={id} />
            </TabsContent>

            <TabsContent value="daily-logs">
              <FieldAssignmentsPanel jobId={id} />
              <FieldLaborSummary jobId={id} />
              <DailyLogsPanel jobId={id} />
            </TabsContent>

            <TabsContent value="photos">
              <JobPhotoGallery jobId={id} />
            </TabsContent>

            <TabsContent value="inspections" className="space-y-2">
              {job.inspections?.map((i: { id: string; type: string; result: string; scheduledDate: string | null; notes: string | null }) => (
                <Card key={i.id}>
                  <CardContent className="flex items-center justify-between py-3 px-4">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{i.type}</span>
                      <Badge variant={i.result === "PASSED" ? "default" : "outline"} className="text-[10px]">{i.result}</Badge>
                    </div>
                    {i.scheduledDate && <span className="text-xs text-muted-foreground">{format(new Date(i.scheduledDate), "MMM d, yyyy")}</span>}
                  </CardContent>
                </Card>
              ))}
              {!job.inspections?.length && <p className="py-6 text-center text-sm text-muted-foreground">No inspections</p>}
            </TabsContent>

            <TabsContent value="tasks">
              <EntityTaskPanel
                context={{
                  jobId: id,
                  label: `${job.jobNumber} · ${job.title}`,
                  href: `/jobs/${id}`,
                }}
                invalidateKeys={[["job", id]]}
                defaultAssigneeId={job.projectManagerId ?? job.salesRepId ?? null}
                emptyText="No tasks on this job yet."
              />
            </TabsContent>

            <TabsContent value="files">
              <FilesPanel leadId={job.leadId} />
            </TabsContent>

            {job.jobType === "OWNED_REHAB" && (
              <TabsContent value="budget">
                <BudgetPanel jobId={id} totalJobCost={Number(job.contractAmount)} />
              </TabsContent>
            )}

            <TabsContent value="history" className="space-y-2">
              {job.stageHistory?.map((h: { id: string; fromStage: { name: string } | null; toStage: { name: string }; changedBy: { firstName: string; lastName: string }; changedAt: string }) => (
                <Card key={h.id}>
                  <CardContent className="flex items-center justify-between py-3 px-4 text-sm">
                    <div className="flex items-center gap-2">
                      {h.fromStage && <><Badge variant="outline" className="text-xs">{h.fromStage.name}</Badge><span>&rarr;</span></>}
                      <Badge variant="outline" className="text-xs">{h.toStage.name}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                      <div>{format(new Date(h.changedAt), "MMM d, h:mm a")}</div>
                      <div>{h.changedBy.firstName} {h.changedBy.lastName}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

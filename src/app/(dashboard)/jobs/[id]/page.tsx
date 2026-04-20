"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft, DollarSign, MapPin, User, Calendar, Hammer, Shield, ClipboardCheck,
} from "lucide-react";
import Link from "next/link";
import { FilesPanel } from "@/components/files/files-panel";
import { InvoicesPanel } from "@/components/jobs/invoices-panel";
import { ExpensesPanel } from "@/components/jobs/expenses-panel";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: job, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: () => fetch(`/api/jobs/${id}`).then((r) => r.json()),
  });

  const { data: stages } = useQuery({
    queryKey: ["jobStages"],
    queryFn: () => fetch("/api/jobs/stages").then((r) => r.json()),
  });

  const { data: crews } = useQuery({
    queryKey: ["crews"],
    queryFn: () => fetch("/api/jobs/stages").then((r) => r.json()), // placeholder, will use crews endpoint
  });

  const changeStage = useMutation({
    mutationFn: (stageId: string) =>
      fetch(`/api/jobs/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["job", id] }); toast.success("Stage updated"); },
  });

  const [payAmount, setPayAmount] = useState("");
  const [payType, setPayType] = useState("DEPOSIT");
  const [payMethod, setPayMethod] = useState("CHECK");
  const [payReference, setPayReference] = useState("");

  const recordPayment = useMutation({
    mutationFn: (data: {
      paymentType: string;
      amount: number;
      method: string;
      reference: string;
    }) =>
      fetch(`/api/jobs/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      setPayAmount("");
      setPayReference("");
      toast.success("Payment recorded");
    },
  });

  const [permitMuni, setPermitMuni] = useState("");
  const [permitType, setPermitType] = useState("");

  const addPermit = useMutation({
    mutationFn: (data: { municipality: string; permitType: string }) =>
      fetch(`/api/jobs/${id}/permits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      setPermitMuni(""); setPermitType("");
      toast.success("Permit added");
    },
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading...</p></div>;
  if (!job || job.error) return <div className="py-20 text-center"><p>Job not found</p><Button variant="outline" onClick={() => router.push("/jobs")}>Back</Button></div>;

  const depositPct = Number(job.depositRequired) > 0
    ? Math.round((Number(job.depositReceived) / Number(job.depositRequired)) * 100) : 0;
  const totalPaid = (job.payments || [])
    .filter((p: { status: string }) => p.status === "RECEIVED")
    .reduce((sum: number, p: { amount: string }) => sum + Number(p.amount), 0);

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => router.push("/jobs")} className="mb-4">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Jobs
      </Button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{job.jobNumber}</h1>
            <Badge variant="outline" className="text-sm">{job.currentStage.name}</Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1">{job.title}</p>
          <Link href={`/leads/${job.lead.id}`} className="text-xs text-blue-600 hover:underline">
            View lead: {job.lead.fullName}
          </Link>
        </div>
        <div className="flex gap-2 items-center">
          {job.nextAction && (
            <span className="text-sm text-amber-700 bg-amber-50 px-3 py-1 rounded-md font-medium">
              Next: {job.nextAction}
            </span>
          )}
          <Select value={job.currentStage.id} onValueChange={(v: string | null) => v && changeStage.mutate(v)}>
            <SelectTrigger className="w-[220px]">
              <SelectValue>
                {(v: string) =>
                  stages?.find((s: { id: string; name: string }) => s.id === v)?.name ??
                  job.currentStage.name
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {stages?.map((s: { id: string; name: string }) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Financial summary cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><DollarSign className="h-4 w-4" /> Contract</div>
            <div className="text-2xl font-bold">${Number(job.contractAmount).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><DollarSign className="h-4 w-4" /> Deposit</div>
            <div className="text-2xl font-bold">${Number(job.depositReceived).toLocaleString()}</div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${depositPct >= 100 ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${Math.min(depositPct, 100)}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">{depositPct}%</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><DollarSign className="h-4 w-4" /> Total Paid</div>
            <div className="text-2xl font-bold text-green-600">${totalPaid.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><DollarSign className="h-4 w-4" /> Balance Due</div>
            <div className={`text-2xl font-bold ${Number(job.balanceDue) > 0 ? "text-red-600" : "text-green-600"}`}>
              ${Number(job.balanceDue).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

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
        </div>

        {/* Right column: tabs */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="payments">
            <TabsList>
              <TabsTrigger value="payments">Payments ({job.payments?.length || 0})</TabsTrigger>
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="expenses">Expenses</TabsTrigger>
              <TabsTrigger value="permits">Permits ({job.permits?.length || 0})</TabsTrigger>
              <TabsTrigger value="crews">Crews</TabsTrigger>
              <TabsTrigger value="inspections">Inspections</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({job.tasks?.length || 0})</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

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
                    <Button size="sm" disabled={!payAmount || recordPayment.isPending}
                      onClick={() => recordPayment.mutate({
                        paymentType: payType,
                        amount: Number(payAmount),
                        method: payMethod,
                        reference: payReference,
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
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {!job.payments?.length && <p className="py-6 text-center text-sm text-muted-foreground">No payments recorded</p>}
              </div>
            </TabsContent>

            <TabsContent value="invoices">
              <InvoicesPanel jobId={id} />
            </TabsContent>

            <TabsContent value="expenses">
              <ExpensesPanel
                jobId={id}
                contractAmount={Number(job.contractAmount)}
              />
            </TabsContent>

            <TabsContent value="permits" className="space-y-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex gap-2">
                    <Input placeholder="Municipality" value={permitMuni}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPermitMuni(e.target.value)} className="flex-1" />
                    <Input placeholder="Permit type" value={permitType}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPermitType(e.target.value)} className="w-[160px]" />
                    <Button size="sm" disabled={!permitMuni || addPermit.isPending}
                      onClick={() => addPermit.mutate({ municipality: permitMuni, permitType })}>
                      Add Permit
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-2">
                {job.permits?.map((p: { id: string; permitType: string | null; municipality: string; status: string; permitNumber: string | null; submittedDate: string | null; approvedDate: string | null }) => (
                  <Card key={p.id}>
                    <CardContent className="flex items-center justify-between py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm font-medium">{p.permitType || "General"}</span>
                          <span className="text-xs text-muted-foreground ml-2">({p.municipality})</span>
                          {p.permitNumber && <span className="text-xs ml-2">#{p.permitNumber}</span>}
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

            <TabsContent value="tasks" className="space-y-2">
              {job.tasks?.map((t: { id: string; title: string; status: string; priority: string; dueAt: string | null }) => (
                <Card key={t.id}>
                  <CardContent className="flex items-center justify-between py-3 px-4">
                    <div>
                      <span className={`text-sm ${t.status === "COMPLETED" ? "line-through text-muted-foreground" : ""}`}>{t.title}</span>
                      <Badge variant={t.priority === "URGENT" ? "destructive" : "outline"} className="text-[10px] ml-2">{t.priority}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.dueAt ? format(new Date(t.dueAt), "MMM d") : t.status}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {!job.tasks?.length && <p className="py-6 text-center text-sm text-muted-foreground">No tasks</p>}
            </TabsContent>

            <TabsContent value="files">
              <FilesPanel leadId={job.leadId} />
            </TabsContent>

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
        </div>
      </div>
    </div>
  );
}

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RecordRecent } from "@/components/shared/record-recent";
import { formatAddressLine } from "@/lib/labels/address";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { EntityHeader } from "@/components/shared/entity-header";
import { StageBadge } from "@/components/shared/stage-badge";
import { StageStepper } from "@/components/shared/stage-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { FilesPanel } from "@/components/files/files-panel";
import { NurtureCard } from "@/components/leads/nurture-card";
import { LeadEstimatesPanel } from "@/components/estimates/lead-estimates-panel";
import { RoofrPanel } from "@/components/roofr/roofr-panel";
import { EntityTaskPanel } from "@/components/tasks/entity-task-panel";
import { CaseListMini } from "@/components/violations/case-list-mini";
import { useTasks } from "@/components/tasks/use-tasks";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { ContactCard } from "@/components/shared/contact-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Phone,
  User,
  Calendar,
  AlertTriangle,
  Clock,
  FileText,
  MessageSquare,
  ShieldCheck,
  StickyNote,
  Pencil,
} from "lucide-react";

const LEAD_TABS = ["activity", "tasks", "comms", "permits", "estimates", "roofr", "files", "violations", "history"];

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [noteContent, setNoteContent] = useState("");

  const { get: getUrl, set: setUrl } = useSearchParamState();
  const tab = LEAD_TABS.includes(getUrl("tab") ?? "") ? (getUrl("tab") as string) : "activity";

  const { data: lead, isLoading, error: leadError, refetch: refetchLead, isRefetching } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => fetchJson(`/api/leads/${id}`),
    retry: retryServerErrors,
  });

  const { data: stages } = useQuery({
    queryKey: ["stages"],
    queryFn: () => fetchJson("/api/admin/stages"),
  });

  const { data: users } = useQuery({
    queryKey: ["assignable-users"],
    queryFn: () => fetchJson("/api/users/assignable"),
  });

  // Scoped through /api/tasks so the count matches what this viewer may see.
  const { data: leadTasks = [] } = useTasks({ leadId: id });

  const changeStage = useMutation({
    mutationFn: (stageId: string) =>
      fetchJson(`/api/leads/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }),
    onSuccess: (updated: { job?: { id: string; jobNumber: string } | null }) => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      if (updated?.job) {
        // Won → a job exists. The workflow is the next thing to set up on it.
        const job = updated.job;
        toast.success(`Job created — ${formatAddressLine(lead) || job.jobNumber}`, {
          description: "Apply a workflow, or start the estimate and customer contract.",
          action: { label: "Set up its workflow", onClick: () => router.push(`/jobs/${job.id}?tab=workflow&apply=1`) },
          cancel: { label: "Estimate & contract", onClick: () => router.push(`/jobs/${job.id}?tab=money&sub=estimates`) },
          duration: 12_000,
        });
      } else {
        toast.success("Stage updated");
      }
    },
    onError: (e: Error) => toast.error(e.message || "Could not change the stage"),
  });

  const assignLead = useMutation({
    mutationFn: (assignedUserId: string) =>
      fetchJson(`/api/leads/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      toast.success("Lead reassigned");
    },
    onError: (e: Error) => toast.error(e.message || "Could not reassign the lead"),
  });

  const addNote = useMutation({
    mutationFn: (content: string) =>
      fetchJson(`/api/leads/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      setNoteContent("");
      toast.success("Note added");
    },
    onError: (e: Error) => toast.error(e.message || "Could not add the note"),
  });

  const logComm = useMutation({
    mutationFn: (data: { communicationType: string; body: string }) =>
      fetchJson(`/api/leads/${id}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      toast.success("Communication logged");
    },
    onError: (e: Error) => toast.error(e.message || "Could not log that"),
  });

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading lead">
        <Skeleton className="mb-2 h-3 w-24" />
        <Skeleton className="mb-2 h-7 w-72" />
        <Skeleton className="mb-6 h-4 w-80" />
        <Skeleton className="mb-6 h-10 w-full" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4">
            <Skeleton className="h-56" />
            <Skeleton className="h-32" />
          </div>
          <div className="lg:col-span-2">
            <Skeleton className="mb-4 h-9 w-full" />
            <Skeleton className="h-72" />
          </div>
        </div>
      </div>
    );
  }

  // A lead that isn't there and a lead we couldn't reach are different
  // problems; "not found" for both once sent people hunting a deleted record.
  if (leadError || !lead) {
    const missing = leadError instanceof HttpError && leadError.isNotFound;
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div>
          <p className="font-medium">{missing ? "Lead not found" : "Couldn't load this lead"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {missing ? "It may have been deleted, or the link may be wrong." : leadError instanceof Error ? leadError.message : "Something went wrong loading this lead."}
          </p>
        </div>
        <div className="flex gap-2">
          {!missing && (
            <Button variant="outline" onClick={() => refetchLead()} disabled={isRefetching}>
              {isRefetching ? "Retrying..." : "Try again"}
            </Button>
          )}
          <Button variant={missing ? "outline" : "ghost"} onClick={() => router.push("/leads")}>
            Back to Leads
          </Button>
        </div>
      </div>
    );
  }

  const isOverdue =
    lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) < new Date();

  return (
    <div>
      <RecordRecent item={{ type: "lead", id, primary: formatAddressLine(lead) || lead.fullName, secondary: formatAddressLine(lead) ? lead.fullName : null, code: null, href: `/leads/${id}` }} />
      <EntityHeader
        breadcrumb={[{ label: "Leads", href: "/leads" }, { label: lead.fullName }]}
        title={lead.fullName}
        subtitle={
          <>
            Created {format(new Date(lead.createdAt), "MMM d, yyyy 'at' h:mm a")}
            {lead.createdBy && ` by ${lead.createdBy.firstName} ${lead.createdBy.lastName}`}
          </>
        }
        badges={
          <>
            {lead.urgent && <Badge variant="destructive">URGENT</Badge>}
            {lead.isDuplicateFlag && <Badge variant="destructive" className="text-xs">DUPLICATE</Badge>}
          </>
        }
        actions={
          <Button variant="outline" onClick={() => router.push(`/leads/${id}/edit`)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        }
      >
        {stages && (
          <StageStepper
            stages={stages}
            currentStageId={lead.currentStage.id}
            entityLabel={lead.fullName}
            disabled={changeStage.isPending}
            onChange={(stageId) => changeStage.mutate(stageId)}
            confirmNote={(_from, to) => (to.isWon ? "Marking a lead Won creates its job and the deposit task." : null)}
          />
        )}
      </EntityHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: contact and property info */}
        <div className="space-y-4">
          <ContactCard
            name={lead.fullName}
            companyName={lead.companyName}
            phone={lead.primaryPhone}
            secondaryPhone={lead.secondaryPhone}
            email={lead.email}
            address={lead}
            county={lead.county}
            propertyType={lead.propertyType}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>
                  {lead.assignedUser
                    ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
                    : "Unassigned"}
                </span>
              </div>
              <Select
                value={lead.assignedUser?.id || ""}
                onValueChange={(v: string | null) => v && assignLead.mutate(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Reassign..." />
                </SelectTrigger>
                <SelectContent>
                  {users
                    ?.filter((u: { isActive: boolean }) => u.isActive)
                    .map((u: { id: string; firstName: string; lastName: string }) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <NurtureCard leadId={id} />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Source:</span>{" "}
                {lead.source?.name || "—"}
                {lead.sourceDetail && ` (${lead.sourceDetail})`}
              </div>
              {lead.estimatedJobValue && (
                <div>
                  <span className="text-muted-foreground">Est. Value:</span>{" "}
                  ${Number(lead.estimatedJobValue).toLocaleString()}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {lead.services?.map(
                  (s: { serviceCategory: { id: string; name: string } }) => (
                    <Badge key={s.serviceCategory.id} variant="outline">
                      {s.serviceCategory.name}
                    </Badge>
                  )
                )}
              </div>
              <Separator />
              <div className="flex flex-wrap gap-3">
                {lead.insuranceClaim && <Badge>Insurance Claim</Badge>}
                {lead.financingNeeded && <Badge variant="secondary">Financing</Badge>}
              </div>
              <div className={`flex items-center gap-2 ${isOverdue ? "text-red-600 font-medium" : ""}`}>
                <Calendar className="h-4 w-4" />
                Next Follow-Up:{" "}
                {lead.nextFollowUpAt
                  ? format(new Date(lead.nextFollowUpAt), "MMM d, yyyy h:mm a")
                  : "Not set"}
                {isOverdue && <AlertTriangle className="h-4 w-4" />}
              </div>
              {lead.lastContactAt && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Last contact: {formatDistanceToNow(new Date(lead.lastContactAt))} ago
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: tabs */}
        <div className="lg:col-span-2">
          <Tabs value={tab} onValueChange={(v) => v && setUrl("tab", v === "activity" ? null : String(v))}>
            <TabsList>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({leadTasks.length})</TabsTrigger>
              <TabsTrigger value="comms">Communications</TabsTrigger>
              <TabsTrigger value="permits">Permits</TabsTrigger>
              <TabsTrigger value="estimates">Estimates</TabsTrigger>
              <TabsTrigger value="roofr">Roofr</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
              <TabsTrigger value="violations">Violations</TabsTrigger>
              <TabsTrigger value="history">Stage History</TabsTrigger>
            </TabsList>

            <TabsContent value="activity" className="space-y-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Add a note..."
                      value={noteContent}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNoteContent(e.target.value)}
                      rows={2}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      disabled={!noteContent.trim() || addNote.isPending}
                      onClick={() => addNote.mutate(noteContent)}
                    >
                      Add Note
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {lead.activityLogs?.map(
                  (activity: {
                    id: string;
                    activityType: string;
                    title: string;
                    description: string | null;
                    createdAt: string;
                    createdBy: { firstName: string; lastName: string } | null;
                  }) => (
                    <Card key={activity.id}>
                      <CardContent className="py-3 px-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3">
                            <ActivityIcon type={activity.activityType} />
                            <div>
                              <p className="text-sm font-medium">{activity.title}</p>
                              {activity.description && (
                                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                                  {activity.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground text-right shrink-0 ml-4">
                            <div>{format(new Date(activity.createdAt), "MMM d, h:mm a")}</div>
                            {activity.createdBy && (
                              <div>
                                {activity.createdBy.firstName} {activity.createdBy.lastName}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
                {!lead.activityLogs?.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No activity yet
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="tasks">
              <EntityTaskPanel
                context={{ leadId: id, label: lead.fullName, href: `/leads/${id}` }}
                invalidateKeys={[["lead", id]]}
                defaultAssigneeId={lead.assignedUserId ?? null}
                emptyText="No tasks on this lead yet."
              />
            </TabsContent>

            <TabsContent value="comms" className="space-y-4">
              <Card>
                <CardContent className="pt-4">
                  <CommLogForm onSubmit={(data) => logComm.mutate(data)} loading={logComm.isPending} />
                </CardContent>
              </Card>

              <div className="space-y-2">
                {lead.communications?.map(
                  (comm: {
                    id: string;
                    communicationType: string;
                    direction: string;
                    body: string;
                    createdAt: string;
                  }) => (
                    <Card key={comm.id}>
                      <CardContent className="py-3 px-4">
                        <div className="flex justify-between">
                          <div className="flex items-start gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {comm.communicationType} {comm.direction}
                            </Badge>
                            <p className="text-sm">{comm.body}</p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 ml-4">
                            {format(new Date(comm.createdAt), "MMM d, h:mm a")}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
                {!lead.communications?.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No communications logged
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="permits" className="space-y-4">
              <div className="space-y-2">
                {lead.permits?.map(
                  (permit: {
                    id: string;
                    permitNumber: string | null;
                    permitType: string | null;
                    permitStatus: string;
                    municipality: string;
                    issueDate: string | null;
                    permitDescription: string | null;
                  }) => (
                    <Card key={permit.id}>
                      <CardContent className="py-3 px-4">
                        <div className="flex justify-between">
                          <div>
                            <p className="text-sm font-medium">
                              {permit.permitNumber || "No number"} — {permit.permitType || "Unknown type"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {permit.municipality} | Status: {permit.permitStatus}
                            </p>
                            {permit.permitDescription && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {permit.permitDescription}
                              </p>
                            )}
                          </div>
                          {permit.issueDate && (
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(permit.issueDate), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
                {!lead.permits?.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No permits on record
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="estimates">
              <LeadEstimatesPanel leadId={id} services={lead.services ?? []} />
            </TabsContent>

            <TabsContent value="roofr">
              <RoofrPanel leadId={id} />
            </TabsContent>

            <TabsContent value="files">
              <FilesPanel leadId={id} />
            </TabsContent>

            <TabsContent value="violations">
              <CaseListMini scope={{ leadId: id }} newHref={`/violations/new?leadId=${id}`} />
            </TabsContent>

            <TabsContent value="history" className="space-y-2">
              {lead.stageHistory?.map(
                (h: {
                  id: string;
                  fromStage: { name: string } | null;
                  toStage: { name: string };
                  changedBy: { firstName: string; lastName: string };
                  changedAt: string;
                  reason: string | null;
                }) => (
                  <Card key={h.id}>
                    <CardContent className="flex items-center justify-between py-3 px-4">
                      <div className="flex items-center gap-2 text-sm">
                        {h.fromStage ? (
                          <>
                            <StageBadge stage={h.fromStage.name} stages={stages} />
                            <span className="text-muted-foreground">&rarr;</span>
                          </>
                        ) : null}
                        <StageBadge stage={h.toStage.name} stages={stages} />
                        {h.reason && (
                          <span className="text-muted-foreground ml-2">— {h.reason}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        <div>{format(new Date(h.changedAt), "MMM d, h:mm a")}</div>
                        <div>
                          {h.changedBy.firstName} {h.changedBy.lastName}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              )}
              {!lead.stageHistory?.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No stage history
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const iconClass = "h-4 w-4 mt-0.5 text-muted-foreground";
  switch (type) {
    case "NOTE":
      return <StickyNote className={iconClass} />;
    case "STAGE_CHANGE":
      return <FileText className={iconClass} />;
    case "CALL_LOGGED":
      return <Phone className={iconClass} />;
    case "SMS_LOGGED":
      return <MessageSquare className={iconClass} />;
    case "PERMIT_ADDED":
      return <ShieldCheck className={iconClass} />;
    default:
      return <Clock className={iconClass} />;
  }
}

function CommLogForm({
  onSubmit,
  loading,
}: {
  onSubmit: (data: { communicationType: string; body: string }) => void;
  loading: boolean;
}) {
  const [type, setType] = useState("CALL");
  const [body, setBody] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select value={type} onValueChange={(v: string | null) => setType(v ?? "CALL")}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CALL">Call</SelectItem>
            <SelectItem value="SMS">SMS</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Log communication..."
          value={body}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBody(e.target.value)}
          className="flex-1"
        />
        <Button
          size="sm"
          disabled={!body.trim() || loading}
          onClick={() => {
            onSubmit({ communicationType: type, body });
            setBody("");
          }}
        >
          Log
        </Button>
      </div>
    </div>
  );
}
